"""
Temporal alignment engine.

Maps each earnings call quarter to the correct subsequent 10-Q/10-K filing,
returning an AlignmentDecision with structured rationale and confidence.

Entry point: ``align_call_to_actuals(ticker, call_quarter) -> AlignmentDecision``
Never raises — all error paths return an AlignmentDecision with appropriate status.
All EDGAR HTTP calls go through ``get_client()`` — never direct httpx calls.
"""
import json
from datetime import datetime, timedelta

from src.core.edgar_client import EdgarFetchError, get_client
from src.core.logging import get_logger
from src.models.alignment_models import AlignmentDecision
from src.services.ingestion_service import resolve_cik

logger = get_logger("ml-sidecar.temporal_aligner")


# ── Quarter arithmetic helpers ────────────────────────────────────────────────

def _next_quarter(quarter: str) -> str:
    """Advance quarter by one. Raises ValueError on bad input."""
    try:
        parts = quarter.split("-")
        if len(parts) != 2 or not parts[0].upper().startswith("Q"):
            raise ValueError
        q_num = int(parts[0][1:])  # parse full suffix after "Q" to catch "Q10", "Q11", etc.
        year = int(parts[1])
        if q_num not in (1, 2, 3, 4):
            raise ValueError
    except (IndexError, ValueError):
        raise ValueError(f"Invalid quarter format: {quarter!r}. Expected 'Q{{n}}-{{YYYY}}'")
    if q_num == 4:
        return f"Q1-{year + 1}"
    return f"Q{q_num + 1}-{year}"


def _quarter_to_period_end(quarter: str) -> str:
    """Map 'Q3-2024' → '2024-09-30'."""
    try:
        parts = quarter.split("-")
        q_num = int(parts[0][1])
        year = int(parts[1])
        if q_num not in (1, 2, 3, 4):
            raise ValueError
    except (IndexError, ValueError):
        raise ValueError(f"Invalid quarter format: {quarter!r}")
    ends = {1: f"{year}-03-31", 2: f"{year}-06-30", 3: f"{year}-09-30", 4: f"{year}-12-31"}
    return ends[q_num]


def _quarter_to_filing_type(quarter: str) -> str:
    """Return '10-K' for Q4, '10-Q' otherwise. Raises ValueError on bad input."""
    upper = quarter.upper() if isinstance(quarter, str) else ""
    if not upper.startswith("Q") or len(upper) < 2:
        raise ValueError(f"Invalid quarter format: {quarter!r}. Expected 'Q{{n}}-{{YYYY}}'")
    return "10-K" if upper.startswith("Q4") else "10-Q"


# ── EDGAR filing lookup ───────────────────────────────────────────────────────

async def _find_filing_url(ticker: str, cik: str, quarter: str, filing_type: str) -> str | None:
    """Return the EDGAR index URL for the earliest matching filing, or None."""
    url = f"https://data.sec.gov/submissions/CIK{cik}.json"
    response = await get_client().fetch(url, ticker=ticker, filing_type="submissions")
    try:
        payload = response.json()
    except json.JSONDecodeError as exc:
        raise EdgarFetchError(ticker=ticker, filing_type="submissions", url=url, final_status=response.status_code) from exc

    period_end_dt = datetime.strptime(_quarter_to_period_end(quarter), "%Y-%m-%d")
    cutoff_dt = period_end_dt + timedelta(days=180)

    matches: list[tuple[datetime, str]] = []

    def _collect_from_recent(recent: dict) -> None:
        acc_numbers = recent.get("accessionNumber", [])
        filing_dates = recent.get("filingDate", [])
        forms = recent.get("form", [])
        for acc_no, filing_date_str, form in zip(acc_numbers, filing_dates, forms):
            if form != filing_type:
                continue
            try:
                filing_dt = datetime.strptime(filing_date_str, "%Y-%m-%d")
            except ValueError:
                continue
            if period_end_dt <= filing_dt <= cutoff_dt:
                matches.append((filing_dt, acc_no))

    filings = payload.get("filings", {})
    _collect_from_recent(filings.get("recent", {}))

    for page_entry in filings.get("files", []):
        page_name = page_entry.get("name", "")
        page_url = f"https://data.sec.gov/submissions/{page_name}"
        page_resp = await get_client().fetch(page_url, ticker=ticker, filing_type="submissions")
        try:
            page_payload = page_resp.json()
        except json.JSONDecodeError as exc:
            raise EdgarFetchError(ticker=ticker, filing_type="submissions", url=page_url, final_status=page_resp.status_code) from exc
        _collect_from_recent(page_payload.get("recent", {}))

    if not matches:
        return None

    matches.sort(key=lambda t: t[0])
    _, acc_no = matches[0]
    cik_int = str(int(cik))
    acc_path = acc_no.replace("-", "")
    return f"https://www.sec.gov/Archives/edgar/data/{cik_int}/{acc_path}/{acc_no}-index.htm"


# ── Decision logger ───────────────────────────────────────────────────────────

def _log_decision(decision: AlignmentDecision) -> None:
    logger.info("temporal alignment decision", extra={
        "ticker": decision.ticker,
        "call_quarter": decision.call_quarter,
        "actuals_quarter": decision.actuals_quarter,
        "filing_type": decision.filing_type,
        "filing_url": decision.filing_url,
        "alignment_confidence": decision.alignment_confidence,
        "mapping_rationale": decision.mapping_rationale,
        "status": decision.status,
    })


# ── Main entry point ──────────────────────────────────────────────────────────

async def align_call_to_actuals(ticker: str, call_quarter: str) -> AlignmentDecision:
    """Map an earnings call quarter to its verification actuals filing.

    Never raises — all error paths return an AlignmentDecision with appropriate status.
    Every call produces exactly one _log_decision call (NFR8).
    """
    try:
        actuals_quarter = _next_quarter(call_quarter)
        filing_type = _quarter_to_filing_type(actuals_quarter)
    except ValueError:
        decision = AlignmentDecision(
            ticker=ticker,
            call_quarter=call_quarter,
            actuals_quarter="",
            filing_type="",
            filing_url="",
            alignment_confidence="LOW",
            mapping_rationale=f"Invalid quarter format: {call_quarter!r}",
            status="FETCH_ERROR",
        )
        _log_decision(decision)
        return decision

    try:
        cik = await resolve_cik(ticker)
    except ValueError:
        decision = AlignmentDecision(
            ticker=ticker,
            call_quarter=call_quarter,
            actuals_quarter=actuals_quarter,
            filing_type=filing_type,
            filing_url="",
            alignment_confidence="LOW",
            mapping_rationale=f"Unknown ticker: {ticker}",
            status="FETCH_ERROR",
        )
        _log_decision(decision)
        return decision

    try:
        filing_url = await _find_filing_url(ticker, cik, actuals_quarter, filing_type)
    except EdgarFetchError:
        decision = AlignmentDecision(
            ticker=ticker,
            call_quarter=call_quarter,
            actuals_quarter=actuals_quarter,
            filing_type=filing_type,
            filing_url="",
            alignment_confidence="LOW",
            mapping_rationale=f"EDGAR fetch error for {ticker} {actuals_quarter} {filing_type}",
            status="FETCH_ERROR",
        )
        _log_decision(decision)
        return decision

    if filing_url is not None:
        decision = AlignmentDecision(
            ticker=ticker,
            call_quarter=call_quarter,
            actuals_quarter=actuals_quarter,
            filing_type=filing_type,
            filing_url=filing_url,
            alignment_confidence="HIGH",
            mapping_rationale=f"Calendar quarter succession: {call_quarter} → {actuals_quarter}; {filing_type} confirmed",
            status="ALIGNED",
        )
        _log_decision(decision)
        return decision

    # Primary filing not found — try alternate quarter
    alt_quarter = _next_quarter(actuals_quarter)
    alt_filing_type = _quarter_to_filing_type(alt_quarter)

    try:
        alt_url = await _find_filing_url(ticker, cik, alt_quarter, alt_filing_type)
    except EdgarFetchError:
        decision = AlignmentDecision(
            ticker=ticker,
            call_quarter=call_quarter,
            actuals_quarter=alt_quarter,
            filing_type=alt_filing_type,
            filing_url="",
            alignment_confidence="LOW",
            mapping_rationale=f"EDGAR fetch error on alternate quarter {alt_quarter} for {ticker}",
            status="FETCH_ERROR",
        )
        _log_decision(decision)
        return decision

    if alt_url is not None:
        decision = AlignmentDecision(
            ticker=ticker,
            call_quarter=call_quarter,
            actuals_quarter=alt_quarter,
            filing_type=alt_filing_type,
            filing_url=alt_url,
            alignment_confidence="LOW",
            mapping_rationale=f"Primary quarter {actuals_quarter} not found; aligned to {alt_quarter} — possible fiscal year offset",
            status="ALIGNED",
        )
        _log_decision(decision)
        return decision

    decision = AlignmentDecision(
        ticker=ticker,
        call_quarter=call_quarter,
        actuals_quarter=actuals_quarter,
        filing_type=filing_type,
        filing_url="",
        alignment_confidence="LOW",
        mapping_rationale=f"No {filing_type} found for {actuals_quarter} or {alt_quarter} — filing may not yet be available",
        status="PENDING",
    )
    _log_decision(decision)
    return decision
