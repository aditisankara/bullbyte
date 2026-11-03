"""
10-Q/10-K financial actuals ingestion service.

Entry point: ``ingest_financial_actuals(ticker, quarter)``
Returns a ``FinancialsResult``. Checks PostgreSQL cache before fetching from EDGAR
and persists SUCCESS/PARTIAL results after fetching.
All HTTP calls go through ``get_client()`` from ``src.core.edgar_client``.
"""
import asyncio
import json
import re
import time
from datetime import datetime, timedelta

import asyncpg
from bs4 import BeautifulSoup

from src.core.edgar_client import EdgarFetchError, get_client
from src.core.filing_selector import select_filing_entry
from src.core.logging import get_logger
from src.db.queries import get_cached_financial_actuals, insert_financial_actuals
from src.models.financials_models import (
    FinancialMetric,
    FinancialMetricPeriod,
    FinancialMetricStatus,
    FinancialsResult,
)
from src.services.ingestion_service import resolve_cik
from src.services.yfinance_service import supplement_with_yfinance

logger = get_logger("ml-sidecar.financials_service")

# Per (ticker, quarter) asyncio locks — prevent duplicate EDGAR fetches under concurrency (NFR11)
_FINANCIALS_CACHE_LOCKS: dict[str, asyncio.Lock] = {}
_FINANCIALS_CACHE_LOCKS_META = asyncio.Lock()


async def _get_financials_lock(ticker: str, quarter: str) -> asyncio.Lock:
    key = f"{ticker}:{quarter}"
    async with _FINANCIALS_CACHE_LOCKS_META:
        if key not in _FINANCIALS_CACHE_LOCKS:
            _FINANCIALS_CACHE_LOCKS[key] = asyncio.Lock()
        return _FINANCIALS_CACHE_LOCKS[key]

# Priority-ordered fallback lists. First match in the XBRL facts wins.
XBRL_METRIC_CONCEPTS: dict[str, list[tuple[str, str]]] = {
    "revenue": [
        ("us-gaap", "RevenueFromContractWithCustomerExcludingAssessedTax"),
        ("us-gaap", "Revenues"),
        ("us-gaap", "SalesRevenueNet"),
        ("us-gaap", "SalesRevenueGoodsNet"),
    ],
    "eps_basic": [
        ("us-gaap", "EarningsPerShareBasic"),
    ],
    "eps_diluted": [
        ("us-gaap", "EarningsPerShareDiluted"),
    ],
    "operating_income": [
        ("us-gaap", "OperatingIncomeLoss"),
    ],
    "gross_profit": [
        ("us-gaap", "GrossProfit"),
    ],
    "net_income": [
        ("us-gaap", "NetIncomeLoss"),
        ("us-gaap", "NetIncomeLossAvailableToCommonStockholdersBasic"),
    ],
    # Guidance is frequently given on these lines, so they need an actual to compare to.
    "operating_expenses": [
        ("us-gaap", "OperatingExpenses"),
        ("us-gaap", "CostsAndExpenses"),
    ],
    "other_income": [
        ("us-gaap", "NonoperatingIncomeExpense"),
        ("us-gaap", "OtherNonoperatingIncomeExpense"),
    ],
    "pretax_income": [
        ("us-gaap", "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest"),
        ("us-gaap", "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments"),
    ],
    "income_tax": [
        ("us-gaap", "IncomeTaxExpenseBenefit"),
    ],
    "dividends_per_share": [
        ("us-gaap", "CommonStockDividendsPerShareDeclared"),
    ],
}
# gross_margin (gross_profit / revenue) and tax_rate (income_tax / pretax_income) are derived — not in this map


# ── Task 3: Filing type helper ────────────────────────────────────────────────

def _quarter_to_filing_type(quarter: str) -> str:
    """Return '10-K' for Q4, '10-Q' for Q1/Q2/Q3."""
    return "10-K" if quarter.upper().startswith("Q4") else "10-Q"


# ── Task 4: XBRL facts fetcher ────────────────────────────────────────────────

async def _fetch_xbrl_facts(cik: str, ticker: str) -> dict:
    """Fetch XBRL company facts JSON for ``cik``. Raises ``EdgarFetchError`` on failure."""
    url = f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json"
    response = await get_client().fetch(url, ticker=ticker, filing_type="xbrl-facts")
    try:
        return response.json()
    except (json.JSONDecodeError, ValueError) as exc:
        raise EdgarFetchError(
            ticker=ticker, filing_type="xbrl-facts", url=url, final_status=response.status_code
        ) from exc


# ── Task 5: Period-end calculator ─────────────────────────────────────────────

def _quarter_to_period_end(quarter: str) -> str:
    """Map 'Q3-2024' to approximate calendar period end date for XBRL matching."""
    parts = quarter.split("-")
    if len(parts) != 2 or len(parts[0]) < 2:
        raise ValueError(f"Invalid quarter format {quarter!r}; expected 'Q{{n}}-{{YYYY}}'")
    try:
        q_num = int(parts[0][1])
        year = int(parts[1])
    except ValueError:
        raise ValueError(f"Invalid quarter format {quarter!r}; expected 'Q{{n}}-{{YYYY}}'")
    ends = {1: f"{year}-03-31", 2: f"{year}-06-30", 3: f"{year}-09-30", 4: f"{year}-12-31"}
    if q_num not in ends:
        raise ValueError(f"Invalid quarter number {q_num!r} in {quarter!r}; expected Q1–Q4")
    return ends[q_num]


def _quarter_number(quarter: str) -> int:
    """Extract the 1–4 quarter number from 'Q3-2024'."""
    return int(quarter.split("-")[0][1])


def _fiscal_year_end_from_xbrl(xbrl_data: dict, year: int) -> datetime | None:
    """The fiscal-year-end date for fiscal year `year`, read straight from the
    XBRL FY facts. Off-calendar fiscal years (e.g. NVIDIA's late-January year
    end, labelled a year ahead) are captured as-is instead of being assumed to
    land on Dec 31 — which is what silently mis-dated every quarterly match.

    A 10-K tags several years of comparatives all with the filing's `fy`, so the
    *latest* full-year end date wins. Balance-sheet "instant" facts (no `start`)
    and non-annual durations are skipped so a prior-year opening balance — which
    also carries fp==FY/fy==year — can't be mistaken for the year end."""
    us_gaap = xbrl_data.get("facts", {}).get("us-gaap", {})
    best: datetime | None = None
    for concept_data in us_gaap.values():
        for entries in concept_data.get("units", {}).values():
            for entry in entries:
                if entry.get("fp") != "FY" or int(entry.get("fy", 0)) != year:
                    continue
                start, end = entry.get("start"), entry.get("end")
                if not start or not end:
                    continue
                try:
                    start_dt = datetime.strptime(start, "%Y-%m-%d")
                    end_dt = datetime.strptime(end, "%Y-%m-%d")
                except (ValueError, TypeError):
                    continue
                if (end_dt - start_dt).days < 300:  # not a full fiscal year
                    continue
                if best is None or end_dt > best:
                    best = end_dt
    return best


def _quarter_end_dt(xbrl_data: dict, quarter: str) -> datetime:
    """Expected period-end for `quarter`, anchored to the company's real fiscal
    year-end when XBRL exposes it, falling back to the calendar quarter-end.

    For a fiscal-Q4 the period-end is the fiscal year-end; each earlier quarter
    is stepped back roughly one quarter. This keeps off-calendar filers (NVIDIA,
    Apple, etc.) from being matched against a quarter a full year off."""
    year = int(quarter.split("-")[1])
    q_num = _quarter_number(quarter)
    fy_end = _fiscal_year_end_from_xbrl(xbrl_data, year)
    if fy_end is not None:
        return fy_end - timedelta(days=91 * (4 - q_num))
    return datetime.strptime(_quarter_to_period_end(quarter), "%Y-%m-%d")


def _make_gross_margin_metric(
    revenue_metric: FinancialMetric,
    gross_profit_metric: FinancialMetric,
    ticker: str,
    quarter: str,
    filing_type: str,
    filing_url: str,
    period: FinancialMetricPeriod,
    source: str = "edgar",
) -> FinancialMetric | None:
    """gross_profit / revenue as a 0–1 ratio, or None if not computable."""
    try:
        margin = float(gross_profit_metric.value) / float(revenue_metric.value)
    except (ValueError, ZeroDivisionError) as exc:
        logger.warning(
            "gross_margin derivation skipped",
            extra={"ticker": ticker, "quarter": quarter, "period": period, "reason": str(exc)},
        )
        return None
    return FinancialMetric(
        ticker=ticker,
        quarter=quarter,
        metric_name="gross_margin",
        value=f"{margin:.4f}",
        unit="ratio",
        section_reference="derived:gross_profit/revenue",
        filing_url=filing_url,
        filing_type=filing_type,
        parse_status="SUCCESS",
        period=period,
        source=source,
    )


# ── Task 6: XBRL metric extractor ─────────────────────────────────────────────

def _duration_days(entry: dict) -> int | None:
    """Length of the fact's reporting period, or None for instants / unparseable dates."""
    try:
        start = datetime.strptime(entry["start"], "%Y-%m-%d")
        end = datetime.strptime(entry["end"], "%Y-%m-%d")
    except (KeyError, ValueError, TypeError):
        return None
    return (end - start).days


def _entry_matches_period(
    entry: dict,
    period: FinancialMetricPeriod,
    year: int | None,
    period_end_dt: datetime,
    q_num: int | None,
) -> tuple[bool, int]:
    """Whether `entry` belongs to `period` ("quarterly" the standalone Q, or
    "annual" the FY total), and its day-delta from the expected period end.

    `year` / `q_num` are the fiscal labels; when both are None the filing's exact
    period end (reportDate) is the only anchor and matching is by date and duration."""
    entry_end = entry.get("end", "")
    if not entry_end or "val" not in entry:
        return False, 0
    try:
        entry_end_dt = datetime.strptime(entry_end, "%Y-%m-%d")
    except ValueError:
        return False, 0

    duration = _duration_days(entry)
    delta = abs((entry_end_dt - period_end_dt).days)
    exact = year is None and q_num is None

    if period == "annual":
        if exact:
            if duration is None or duration < 300 or delta > 7:
                return False, 0
            return True, delta
        # fp=="FY" + fy==year is the period specifier; no date constraint so
        # off-calendar fiscal years (e.g. Apple FY ends September) are captured.
        if entry.get("fp") != "FY" or int(entry.get("fy", 0)) != year:
            return False, 0
        return True, delta

    # quarterly: a 10-Q's XBRL facts also carry year-to-date totals (6 and 9 months)
    # ending on the same date with the same fp — only a ~3-month duration is the
    # standalone quarter. Facts without a start (instants) skip the duration check.
    if duration is not None and not 60 <= duration <= 120:
        return False, 0
    if exact:
        return (delta <= 7), delta
    # A 10-K's facts also carry the standalone Q4 figure (fp=="Q4") alongside the FY
    # total — request it explicitly. Entries with no fp fall back to the date window.
    fp = entry.get("fp")
    if fp == "FY" or (fp and fp != f"Q{q_num}"):
        return False, 0
    if delta > 45:
        return False, 0
    return True, delta


def _select_metric_for_period(
    us_gaap: dict,
    concepts: list[tuple[str, str]],
    ticker: str,
    quarter: str,
    metric_name: str,
    filing_type: str,
    filing_url: str,
    period: FinancialMetricPeriod,
    year: int | None,
    period_end_dt: datetime,
    q_num: int | None,
) -> FinancialMetric | None:
    """Best single-concept match for `metric_name` within `period` (quarterly vs
    annual) — mirrors the original per-concept ambiguity-checked selection."""
    matched: FinancialMetric | None = None
    ambiguous = False

    for _namespace, concept_name in concepts:
        concept_data = us_gaap.get(concept_name, {})
        units_map = concept_data.get("units", {})
        if not units_map:
            continue

        if len(units_map) > 1:
            logger.warning(
                "Multiple unit keys for concept — using first",
                extra={"ticker": ticker, "concept": concept_name, "unit_keys": list(units_map)},
            )
        unit_key = next(iter(units_map))
        entries = units_map[unit_key]

        candidates = []
        for entry in entries:
            if entry.get("form") != filing_type:
                continue
            ok, delta = _entry_matches_period(entry, period, year, period_end_dt, q_num)
            if ok:
                candidates.append((delta, entry, unit_key, concept_name))

        if not candidates:
            continue

        candidates.sort(key=lambda x: x[0])
        _best_delta, best_entry, best_unit, best_concept = candidates[0]

        candidate_metric = FinancialMetric(
            ticker=ticker,
            quarter=quarter,
            metric_name=metric_name,
            value=str(best_entry["val"]),
            unit=best_unit,
            section_reference=f"us-gaap/{best_concept}",
            filing_url=filing_url,
            filing_type=filing_type,
            parse_status="SUCCESS",
            period=period,
            period_end=best_entry.get("end"),
        )

        if matched is None:
            matched = candidate_metric
        elif matched.value != candidate_metric.value:
            ambiguous = True
            logger.warning(
                "AMBIGUOUS metric — conflicting concept values",
                extra={
                    "ticker": ticker,
                    "quarter": quarter,
                    "metric_name": metric_name,
                    "period": period,
                    "concept_1": matched.section_reference,
                    "value_1": matched.value,
                    "concept_2": f"us-gaap/{best_concept}",
                    "value_2": candidate_metric.value,
                },
            )
            break
        # Values agree: keep first (most canonical) match and continue scanning

    if matched is not None and ambiguous:
        matched = matched.model_copy(update={"parse_status": "AMBIGUOUS"})
        logger.warning(
            "AMBIGUOUS metric — skipping",
            extra={
                "ticker": ticker,
                "quarter": quarter,
                "metric_name": metric_name,
                "period": period,
                "filing_url": filing_url,
                "section_reference": matched.section_reference,
            },
        )
    return matched


def _extract_xbrl_metrics(
    xbrl_data: dict,
    ticker: str,
    quarter: str,
    filing_type: str,
    filing_url: str,
    report_date: datetime | None = None,
) -> list[FinancialMetric]:
    """Extract structured financial metrics from XBRL company facts data.

    With `report_date` (the filing's own period end from EDGAR) matching is anchored
    to that exact date, independent of how the company labels its fiscal quarters.

    A 10-K's XBRL facts carry both the standalone quarter (fp=="Q4") and the
    full fiscal year (fp=="FY") for the same concept — both are extracted and
    tagged with `period` so a single-quarter claim is never matched against an
    FY total (and vice versa). A 10-Q only ever yields quarterly metrics.
    """
    if report_date is not None:
        period_end_dt, year, q_num = report_date, None, None
    else:
        period_end_dt = _quarter_end_dt(xbrl_data, quarter)
        year = int(quarter.split("-")[1])
        q_num = _quarter_number(quarter)
    periods: list[FinancialMetricPeriod] = (
        ["quarterly", "annual"] if filing_type == "10-K" else ["quarterly"]
    )

    metrics: list[FinancialMetric] = []
    us_gaap = xbrl_data.get("facts", {}).get("us-gaap", {})

    extracted: dict[tuple[str, str], FinancialMetric] = {}

    for metric_name, concepts in XBRL_METRIC_CONCEPTS.items():
        for period in periods:
            matched_metric = _select_metric_for_period(
                us_gaap, concepts, ticker, quarter, metric_name,
                filing_type, filing_url, period, year, period_end_dt, q_num,
            )
            if matched_metric is not None:
                metrics.append(matched_metric)
                extracted[(metric_name, period)] = matched_metric

    # Derive gross_margin from gross_profit / revenue, per period
    for period in periods:
        revenue_metric = extracted.get(("revenue", period))
        gross_profit_metric = extracted.get(("gross_profit", period))
        if revenue_metric and gross_profit_metric:
            gm = _make_gross_margin_metric(
                revenue_metric, gross_profit_metric, ticker, quarter,
                filing_type, filing_url, period,
            )
            if gm is not None:
                metrics.append(gm)

        tax_metric = extracted.get(("income_tax", period))
        pretax_metric = extracted.get(("pretax_income", period))
        if tax_metric and pretax_metric:
            try:
                rate = float(tax_metric.value) / float(pretax_metric.value) * 100
            except (ValueError, ZeroDivisionError):
                rate = None
            if rate is not None:
                metrics.append(FinancialMetric(
                    ticker=ticker, quarter=quarter, metric_name="tax_rate",
                    value=f"{rate:.2f}", unit="percent",
                    section_reference="derived:income_tax/pretax_income",
                    filing_url=filing_url, filing_type=filing_type,
                    parse_status="SUCCESS", period=period,
                    period_end=tax_metric.period_end,
                ))

    return metrics


# ── Task 7: Guidance extractor ────────────────────────────────────────────────

_GUIDANCE_KEYWORDS = ["guidance", "outlook", "expects", "anticipates", "full year", "next quarter", "fiscal year"]
_VALUE_PATTERN = re.compile(r"\$[\d.,]+[BMK]?|\d+\.?\d*%")


async def _extract_guidance_from_html(
    cik: str,
    accession_no: str,
    ticker: str,
    quarter: str,
    filing_type: str,
    filing_url: str,
) -> list[FinancialMetric]:
    """Best-effort: extract forward guidance passages from the primary 10-Q/10-K HTML document."""
    accession_path = accession_no.replace("-", "")
    cik_int = str(int(cik))

    try:
        index_url = (
            f"https://www.sec.gov/Archives/edgar/data/{cik_int}"
            f"/{accession_path}/{accession_no}-index.htm"
        )
        index_resp = await get_client().fetch(index_url, ticker=ticker, filing_type="filing-index")
        soup = BeautifulSoup(index_resp.text, "lxml")

        # Find primary 10-Q/10-K document (not exhibits)
        primary_doc_url: str | None = None
        for row in soup.select("table tr"):
            cells = row.find_all("td")
            if len(cells) < 3:
                continue
            doc_type = cells[1].get_text(strip=True)
            link = cells[2].find("a")
            if link is None:
                continue
            filename = link.get("href", "").split("/")[-1].split("?")[0]
            if not filename:
                continue
            if doc_type in (filing_type, filing_type.replace("-", "")):
                primary_doc_url = (
                    f"https://www.sec.gov/Archives/edgar/data/{cik_int}"
                    f"/{accession_path}/{filename}"
                )
                break

        if primary_doc_url is None:
            logger.warning(
                "Could not find primary filing document in index",
                extra={"ticker": ticker, "quarter": quarter, "index_url": index_url},
            )
            return []

        doc_resp = await get_client().fetch(primary_doc_url, ticker=ticker, filing_type=f"{filing_type}-document")
        doc_soup = BeautifulSoup(doc_resp.text, "lxml")

        guidance_metrics: list[FinancialMetric] = []
        passages_found = 0
        seen_guidance_texts: set[str] = set()

        for tag in doc_soup.find_all(["p", "div", "span"]):
            if passages_found >= 3:
                break
            text = tag.get_text(separator=" ", strip=True).lower()
            keyword_hits = sum(1 for kw in _GUIDANCE_KEYWORDS if kw in text)
            if keyword_hits < 2:
                continue

            full_text = tag.get_text(separator=" ", strip=True)
            # Deduplicate: skip nested tags whose text is a prefix of an already-seen passage
            text_key = full_text[:100]
            if text_key in seen_guidance_texts:
                continue
            seen_guidance_texts.add(text_key)

            value_match = _VALUE_PATTERN.search(full_text)

            # Find nearest heading for section reference
            heading = tag.find_previous(["h1", "h2", "h3", "h4"])
            section_ref = heading.get_text(strip=True) if heading else "guidance-section"

            if value_match:
                extracted_value = value_match.group(0)
                unit = "percent" if "%" in extracted_value else "USD"
                parse_status: FinancialMetricStatus = "SUCCESS"
            else:
                # A prose passage with no figure is not an actual a claim can be
                # checked against — storing it only turned the filing PARTIAL.
                continue

            passages_found += 1
            guidance_metrics.append(FinancialMetric(
                ticker=ticker,
                quarter=quarter,
                metric_name=f"guidance_{passages_found}",
                value=extracted_value,
                unit=unit,
                section_reference=section_ref,
                filing_url=filing_url,
                filing_type=filing_type,
                parse_status=parse_status,
            ))

        return guidance_metrics

    except EdgarFetchError as exc:
        logger.error(
            "Guidance extraction failed — EDGAR fetch error",
            extra={"ticker": ticker, "quarter": quarter, "error": str(exc)},
        )
        return []
    except Exception as exc:
        logger.warning(
            "Guidance extraction failed — parse error",
            extra={"ticker": ticker, "quarter": quarter, "error": str(exc)},
        )
        return []


# ── Task 8: Filing lookup ─────────────────────────────────────────────────────

async def _load_submission_entries(cik: str, ticker: str) -> list[dict]:
    """Every filing in the company's EDGAR submissions index (recent + paginated)."""
    url = f"https://data.sec.gov/submissions/CIK{cik}.json"
    response = await get_client().fetch(url, ticker=ticker, filing_type="submissions")
    try:
        payload = response.json()
    except (json.JSONDecodeError, ValueError) as exc:
        raise EdgarFetchError(
            ticker=ticker, filing_type="submissions", url=url, final_status=response.status_code
        ) from exc

    filings_block = payload.get("filings", {})
    entries = _collect_submission_entries(filings_block.get("recent", {}))

    # Paginated files (large filers)
    for file_meta in filings_block.get("files", []):
        name = file_meta.get("name")
        if not name:
            continue
        page_url = f"https://data.sec.gov/submissions/{name}"
        page_resp = await get_client().fetch(page_url, ticker=ticker, filing_type="submissions-page")
        try:
            page_data = page_resp.json()
        except (json.JSONDecodeError, ValueError) as exc:
            raise EdgarFetchError(
                ticker=ticker, filing_type="submissions-page", url=page_url, final_status=page_resp.status_code
            ) from exc
        entries.extend(_collect_submission_entries(page_data.get("filings", {}).get("recent", {})))
    return entries


async def _find_filing(cik: str, ticker: str, quarter: str, filing_type: str) -> dict | None:
    """Submissions entry (accessionNumber/form/reportDate/...) reporting `quarter`, or None."""
    entries = await _load_submission_entries(cik, ticker)
    return select_filing_entry(entries, quarter, filing_type)


async def _find_filing_accession(
    cik: str, ticker: str, quarter: str, filing_type: str
) -> str | None:
    """Return accession number for the matching 10-Q/10-K filing, or None if not filed yet."""
    entry = await _find_filing(cik, ticker, quarter, filing_type)
    return entry["accessionNumber"] if entry else None


def _collect_submission_entries(recent: dict) -> list[dict]:
    accessions = recent.get("accessionNumber", [])
    dates = recent.get("filingDate", [])
    forms = recent.get("form", [])
    if len({len(accessions), len(dates), len(forms)}) > 1:
        logger.warning(
            "EDGAR submissions arrays have mismatched lengths — zip will truncate",
            extra={"lengths": {"accessionNumber": len(accessions), "filingDate": len(dates), "form": len(forms)}},
        )
    report_dates = recent.get("reportDate", [])
    return [
        {
            "accessionNumber": acc,
            "filingDate": date,
            "form": form,
            "reportDate": report_dates[i] if i < len(report_dates) else "",
        }
        for i, (acc, date, form) in enumerate(zip(accessions, dates, forms))
    ]


# ── Task 9: Top-level orchestrator ────────────────────────────────────────────

def _reconstruct_financials_result(row: asyncpg.Record) -> FinancialsResult:
    """Reconstruct a FinancialsResult from a cached financial_actuals DB row."""
    raw = row["metrics"]
    metrics_data: list[dict] = json.loads(raw) if isinstance(raw, str) else (raw or [])
    metrics = [FinancialMetric(**m) for m in metrics_data]
    return FinancialsResult(
        ticker=row["ticker"],
        quarter=row["quarter"],
        filing_type=row["filing_type"],
        status=row["status"],
        metrics=metrics,
        filing_url=row["filing_url"],
    )


def _cache_row_is_stale(row: asyncpg.Record) -> bool:
    """Rows written before metrics carried `period_end` came from the old extraction
    (year-to-date totals, calendar-assumed fiscal years) and must be re-fetched."""
    raw = row["metrics"]
    metrics_data = json.loads(raw) if isinstance(raw, str) else (raw or [])
    sourced = [m for m in metrics_data if m.get("source", "edgar") == "edgar" and m.get("period_end") is None
               and not m.get("metric_name", "").startswith("guidance")]
    return bool(sourced) and not any(m.get("period_end") for m in metrics_data)


async def ingest_financial_actuals(ticker: str, quarter: str) -> FinancialsResult:
    """
    Fetch and parse 10-Q/10-K financial actuals for ``ticker`` and ``quarter``.

    Args:
        ticker:  US equity ticker symbol (e.g. ``"TSLA"``).
        quarter: Quarter string in canonical format ``"Q{n}-{YYYY}"`` (e.g. ``"Q3-2024"``).

    Returns:
        ``FinancialsResult`` with extracted metrics. No DB writes.
    """
    start_time = time.monotonic()

    # ── Fast-path cache check (no lock — optimistic) ──────────────────────────
    cached = await get_cached_financial_actuals(ticker, quarter)
    if cached and _cache_row_is_stale(cached):
        cached = None
    if cached:
        logger.info(
            "financial actuals cache hit",
            extra={"ticker": ticker, "quarter": quarter, "cache_hit": True},
        )
        return _reconstruct_financials_result(cached)

    # ── Slow-path: acquire per-quarter lock to prevent duplicate EDGAR fetches ─
    _lock = await _get_financials_lock(ticker, quarter)
    async with _lock:
        # Re-check after acquiring lock — another coroutine may have populated it while we waited
        cached = await get_cached_financial_actuals(ticker, quarter)
        if cached and _cache_row_is_stale(cached):
            cached = None
        if cached:
            logger.info(
                "financial actuals cache hit (post-lock re-check)",
                extra={"ticker": ticker, "quarter": quarter, "cache_hit": True},
            )
            return _reconstruct_financials_result(cached)

        # ── EDGAR fetch (existing logic) ──────────────────────────────────────
        filing_type = _quarter_to_filing_type(quarter)

        try:
            cik = await resolve_cik(ticker)
        except ValueError:
            logger.error(
                "Unknown ticker — CIK resolution failed",
                extra={"ticker": ticker, "quarter": quarter},
            )
            return FinancialsResult(
                ticker=ticker, quarter=quarter, filing_type=filing_type,
                status="FETCH_ERROR", metrics=[], filing_url="",
            )
        cik_int = str(int(cik))

        try:
            filing_entry = await _find_filing(cik, ticker, quarter, filing_type)
        except EdgarFetchError as exc:
            logger.error(
                "Submissions fetch failed during filing lookup",
                extra={"ticker": ticker, "quarter": quarter, "error": str(exc)},
            )
            return FinancialsResult(
                ticker=ticker, quarter=quarter, filing_type=filing_type,
                status="FETCH_ERROR", metrics=[], filing_url="",
            )

        if filing_entry is None:
            logger.info(
                "10-Q not yet filed",
                extra={"ticker": ticker, "quarter": quarter, "reason": "no_filing_found"},
            )
            return FinancialsResult(
                ticker=ticker,
                quarter=quarter,
                filing_type=filing_type,
                status="FILING_NOT_YET_AVAILABLE",
                metrics=[],
                filing_url="",
            )

        accession_no = filing_entry["accessionNumber"]
        # The form EDGAR filed the period on (a Dec quarter is a 10-K for Dec filers,
        # a 10-Q for everyone else) — not a Q4 => 10-K guess from the label.
        filing_type = filing_entry.get("form") or filing_type
        try:
            report_date = datetime.strptime(filing_entry.get("reportDate") or "", "%Y-%m-%d")
        except ValueError:
            report_date = None
        accession_path = accession_no.replace("-", "")
        filing_url = (
            f"https://www.sec.gov/Archives/edgar/data/{cik_int}"
            f"/{accession_path}/{accession_no}-index.htm"
        )

        try:
            xbrl_data = await _fetch_xbrl_facts(cik, ticker)
        except EdgarFetchError as exc:
            logger.error(
                "XBRL facts fetch failed",
                extra={"ticker": ticker, "quarter": quarter, "error": str(exc)},
            )
            return FinancialsResult(
                ticker=ticker,
                quarter=quarter,
                filing_type=filing_type,
                status="FETCH_ERROR",
                metrics=[],
                filing_url=filing_url,
            )

        metrics = _extract_xbrl_metrics(
            xbrl_data, ticker, quarter, filing_type, filing_url, report_date=report_date
        )

        # Guidance extraction is best-effort — never fails the overall result
        guidance_metrics = await _extract_guidance_from_html(
            cik, accession_no, ticker, quarter, filing_type, filing_url
        )
        metrics.extend(guidance_metrics)

        # yfinance supplement: fill in AMBIGUOUS or missing XBRL metrics. yfinance's
        # quarterly_income_stmt always reports genuine standalone quarters (including
        # Q4, which it derives itself) — so the gap to check is specifically the
        # *quarterly* variant, not just whether the metric name appears at all. A
        # 10-K commonly has only the [annual] XBRL fact for a concept (e.g. NVIDIA's
        # Revenues), which must not count as satisfying the quarterly figure.
        expected_metrics = set(XBRL_METRIC_CONCEPTS.keys())
        edgar_success_quarterly = {
            m.metric_name for m in metrics if m.parse_status == "SUCCESS" and m.period == "quarterly"
        }
        ambiguous = {m.metric_name for m in metrics if m.parse_status == "AMBIGUOUS" and m.metric_name in expected_metrics}
        missing_quarterly = expected_metrics - {
            m.metric_name for m in metrics if m.period == "quarterly"
        }
        supplement_targets = list(ambiguous | missing_quarterly)

        if supplement_targets:
            # Anchor yfinance's column pick to the real fiscal quarter-end, not the
            # calendar date — otherwise an off-calendar filer (NVIDIA) matches a
            # column a full fiscal year off (e.g. Q4 FY2026 for a Q4 FY2025 request).
            yf_target_date = (report_date or _quarter_end_dt(xbrl_data, quarter)).date()
            yf_metrics = await supplement_with_yfinance(
                ticker, quarter, supplement_targets, target_date=yf_target_date
            )
            yf_added_names = {m.metric_name for m in yf_metrics if m.metric_name not in edgar_success_quarterly}
            metrics = [
                m for m in metrics
                if not (m.metric_name in yf_added_names and m.parse_status == "AMBIGUOUS" and m.period == "quarterly")
            ]
            for yf_metric in yf_metrics:
                if yf_metric.metric_name not in edgar_success_quarterly:
                    metrics.append(yf_metric)

        # Derive a quarterly gross_margin from the yfinance quarterly figures when
        # XBRL exposed none (typical for off-calendar 10-Ks that only carry the
        # annual concept) — so a single-quarter margin claim has a matching actual.
        if not any(m.metric_name == "gross_margin" and m.period == "quarterly" for m in metrics):
            q_rev = next((m for m in metrics if m.metric_name == "revenue" and m.period == "quarterly"), None)
            q_gp = next((m for m in metrics if m.metric_name == "gross_profit" and m.period == "quarterly"), None)
            if q_rev and q_gp:
                gm = _make_gross_margin_metric(
                    q_rev, q_gp, ticker, quarter, filing_type, filing_url, "quarterly",
                    source="yfinance",
                )
                if gm is not None:
                    metrics.append(gm)

        if not metrics:
            result_status = "PARTIAL"
        elif any(m.parse_status == "AMBIGUOUS" for m in metrics):
            result_status = "PARTIAL"
        else:
            result_status = "SUCCESS"

        result = FinancialsResult(
            ticker=ticker,
            quarter=quarter,
            filing_type=filing_type,
            status=result_status,
            metrics=metrics,
            filing_url=filing_url,
        )

        logger.info(
            "financial actuals ingestion complete",
            extra={
                "ticker": ticker,
                "quarter": quarter,
                "filing_type": filing_type,
                "status": result_status,
                "metrics_count": len(metrics),
            },
        )

        if result.status in ("SUCCESS", "PARTIAL"):
            await insert_financial_actuals(
                ticker=result.ticker,
                quarter=result.quarter,
                filing_type=result.filing_type,
                status=result.status,
                filing_url=result.filing_url,
                metrics_json=json.dumps([m.model_dump() for m in result.metrics]),
            )

        logger.info(
            "financial actuals cache miss — EDGAR fetch complete",
            extra={
                "ticker": ticker,
                "quarter": quarter,
                "cache_hit": False,
                "fetch_duration_ms": int((time.monotonic() - start_time) * 1000),
            },
        )
        return result
