"""
8-K earnings call transcript ingestion service.

Entry point: ``ingest_8k_transcripts(ticker, start_date, end_date)``
Returns an ``IngestionSummary``. Checks PostgreSQL cache before fetching from EDGAR
and persists SUCCESS transcripts after fetching.
All HTTP calls go through ``get_client()`` from ``src.core.edgar_client``.
"""
import asyncio
import re
import time
from datetime import datetime

from bs4 import BeautifulSoup

from src.core.edgar_client import EdgarFetchError, get_client
from src.core.logging import get_logger
from src.db.queries import get_cached_transcript, insert_transcript
from src.models.ingestion_models import IngestionSummary, ParseStatus, TranscriptResult

logger = get_logger("ml-sidecar.ingestion_service")

# Populated once on first call to ingest_8k_transcripts(); never re-fetched per request.
_TICKER_CIK_MAP: dict[str, str] = {}
# asyncio.Lock guards against concurrent coroutines racing to populate _TICKER_CIK_MAP.
_cik_map_lock = asyncio.Lock()

# Per (ticker, quarter) asyncio locks — prevent duplicate EDGAR fetches under concurrency (NFR11)
_TRANSCRIPT_CACHE_LOCKS: dict[str, asyncio.Lock] = {}
_TRANSCRIPT_CACHE_LOCKS_META = asyncio.Lock()


async def _get_transcript_lock(ticker: str, quarter: str) -> asyncio.Lock:
    key = f"{ticker}:{quarter}"
    async with _TRANSCRIPT_CACHE_LOCKS_META:
        if key not in _TRANSCRIPT_CACHE_LOCKS:
            _TRANSCRIPT_CACHE_LOCKS[key] = asyncio.Lock()
        return _TRANSCRIPT_CACHE_LOCKS[key]


_TRANSCRIPT_KEYWORDS = [
    "operator",
    "conference call",
    "earnings call",
    "q&a",
    "fiscal quarter",
    "per share",
    "revenue",
]


# ── Task 3: CIK resolution ────────────────────────────────────────────────────

async def _load_ticker_cik_map() -> None:
    """Fetch company_tickers.json and populate _TICKER_CIK_MAP (idempotent, concurrency-safe)."""
    global _TICKER_CIK_MAP
    async with _cik_map_lock:
        if _TICKER_CIK_MAP:
            return
        url = "https://www.sec.gov/files/company_tickers.json"
        response = await get_client().fetch(url, ticker="system", filing_type="tickers")
        data = response.json()
        _TICKER_CIK_MAP = {
            entry["ticker"].upper(): f"{entry['cik_str']:010d}"
            for entry in data.values()
        }


async def resolve_cik(ticker: str) -> str:
    """Return zero-padded 10-digit CIK for ``ticker``, or raise ``ValueError``."""
    await _load_ticker_cik_map()
    cik = _TICKER_CIK_MAP.get(ticker.upper())
    if cik is None:
        raise ValueError(f"Ticker {ticker!r} not found in EDGAR company index")
    return cik


# ── Task 4: 8-K filing discovery ─────────────────────────────────────────────

async def _get_8k_filings(cik: str, start_date: str, end_date: str) -> list[dict]:
    """Return 8-K filings for ``cik`` within [start_date, end_date], sorted ascending."""
    url = f"https://data.sec.gov/submissions/CIK{cik}.json"
    response = await get_client().fetch(url, ticker=cik, filing_type="submissions")
    payload = response.json()

    filings_block = payload.get("filings", {})
    results = _extract_8k_entries(filings_block.get("recent", {}), start_date, end_date)

    # Large filers have additional pages listed in filings.files
    for file_meta in filings_block.get("files", []):
        name = file_meta.get("name")
        if not name:
            logger.warning(
                "Skipping submissions file entry with no 'name' key",
                extra={"cik": cik, "file_meta": str(file_meta)},
            )
            continue
        page_url = f"https://data.sec.gov/submissions/{name}"
        page_resp = await get_client().fetch(page_url, ticker=cik, filing_type="submissions-page")
        page_data = page_resp.json()
        results.extend(_extract_8k_entries(page_data.get("filings", {}).get("recent", {}), start_date, end_date))

    return sorted(results, key=lambda x: x["filing_date"])


def _extract_8k_entries(recent: dict, start_date: str, end_date: str) -> list[dict]:
    accessions = recent.get("accessionNumber", [])
    dates = recent.get("filingDate", [])
    forms = recent.get("form", [])
    if len({len(accessions), len(dates), len(forms)}) > 1:
        logger.warning(
            "EDGAR submissions arrays have mismatched lengths — zip will truncate",
            extra={"lengths": {"accessionNumber": len(accessions), "filingDate": len(dates), "form": len(forms)}},
        )
    return [
        {"accession_no": acc, "filing_date": date}
        for acc, date, form in zip(accessions, dates, forms)
        if form == "8-K" and start_date <= date <= end_date
    ]


# ── Task 5: Filing index → exhibit documents ─────────────────────────────────

async def _get_exhibit_documents(cik: str, accession_no: str) -> list[dict]:
    """Return EX-99 / transcript documents from a filing's index page."""
    accession_path = accession_no.replace("-", "")
    # Archives URLs require the unpadded integer CIK (e.g. "1318605"), not zero-padded
    cik_int = str(int(cik))
    index_url = (
        f"https://www.sec.gov/Archives/edgar/data/{cik_int}"
        f"/{accession_path}/{accession_no}-index.htm"
    )
    response = await get_client().fetch(index_url, ticker=cik, filing_type="filing-index")
    soup = BeautifulSoup(response.text, "lxml")

    docs = []
    for row in soup.select("table tr"):
        cells = row.find_all("td")
        if len(cells) < 3:
            continue
        # Real EDGAR index columns: [Seq, Type, Document, Type, Size]
        doc_type = cells[1].get_text(strip=True)
        link = cells[2].find("a")
        if link is None:
            continue
        # Strip query strings (e.g. href="file.htm?v=2") to get a clean filename
        filename = link.get("href", "").split("/")[-1].split("?")[0]
        if not filename:
            continue
        if doc_type.startswith("EX-99"):
            full_url = (
                f"https://www.sec.gov/Archives/edgar/data/{cik_int}"
                f"/{accession_path}/{filename}"
            )
            docs.append({"type": doc_type, "url": full_url})
    return docs


# ── Task 6: Transcript text extraction ───────────────────────────────────────

async def _extract_transcript_text(
    url: str, ticker: str, filing_date: str
) -> tuple[str | None, ParseStatus]:
    """
    Fetch and score a document. Returns (text, status).

    Raises ``EdgarFetchError`` on HTTP failure — caller must catch and set FETCH_ERROR.
    All other exceptions are caught internally and returned as ``(None, "PARSE_FAILURE")``.
    """
    try:
        response = await get_client().fetch(url, ticker=ticker, filing_type="8-K-exhibit")
        # Strip HTML first so the 8000-char preview is plain text, not markup.
        # This prevents heavy inline CSS / SEC boilerplate from pushing financial
        # keywords past the preview window (e.g. AMZN's 578 KB HTML files where
        # "revenue" first appears well past char 8000 in raw HTML).
        soup = BeautifulSoup(response.text, "lxml")
        raw = soup.get_text(separator="\n", strip=True)
        cleaned = re.sub(r"\n{3,}", "\n\n", raw)
        preview = cleaned[:8000].lower()
        # Use a set to count unique keyword matches per spec (Task 6: "count unique keyword matches")
        score = len({kw for kw in _TRANSCRIPT_KEYWORDS if kw in preview})
        if score >= 3:
            return cleaned, "SUCCESS"
        elif score >= 1:
            return cleaned, "PRESS_RELEASE"
        else:
            return None, "NO_TRANSCRIPT"
    except EdgarFetchError:
        raise  # caller handles FETCH_ERROR
    except Exception as exc:
        logger.error(
            "8-K parse failure",
            extra={"ticker": ticker, "filing_url": url, "filing_date": filing_date, "error": str(exc)},
        )
        return None, "PARSE_FAILURE"


# ── Task 7: Quarter mapping ───────────────────────────────────────────────────

def _filing_date_to_quarter(filing_date: str) -> str:
    """Map an 8-K filing date (YYYY-MM-DD) to the earnings quarter it reports."""
    dt = datetime.strptime(filing_date, "%Y-%m-%d")
    m, y = dt.month, dt.year
    if m <= 3:
        return f"Q4-{y - 1}"
    if m <= 6:
        return f"Q1-{y}"
    if m <= 9:
        return f"Q2-{y}"
    return f"Q3-{y}"


# ── Task 8: Top-level orchestrator ────────────────────────────────────────────

async def ingest_8k_transcripts(
    ticker: str, start_date: str, end_date: str
) -> IngestionSummary:
    """
    Fetch and parse 8-K earnings call transcripts for ``ticker`` over a date range.

    Args:
        ticker:     US equity ticker symbol (e.g. ``"TSLA"``).
        start_date: ISO date string ``"YYYY-MM-DD"`` (inclusive).
        end_date:   ISO date string ``"YYYY-MM-DD"`` (inclusive).

    Returns:
        ``IngestionSummary`` with all results and aggregate counts.
    """
    cik = await resolve_cik(ticker)
    filings = await _get_8k_filings(cik, start_date, end_date)

    results: list[TranscriptResult] = []
    transcripts_extracted = 0
    press_releases_extracted = 0
    skipped_no_transcript = 0
    parse_failures = 0
    fetch_errors = 0

    for filing in filings:
        accession_no = filing["accession_no"]
        filing_date = filing["filing_date"]

        try:
            quarter = _filing_date_to_quarter(filing_date)
        except ValueError:
            logger.error(
                "Malformed filing_date from EDGAR — skipping filing",
                extra={"ticker": ticker, "filing_date": filing_date, "accession_no": accession_no},
            )
            continue

        # ── Cache check ───────────────────────────────────────────────────────
        _lock = await _get_transcript_lock(ticker, quarter)
        async with _lock:
            cached = await get_cached_transcript(ticker, quarter)
            if cached:
                logger.info(
                    "transcript cache hit",
                    extra={
                        "ticker": ticker,
                        "quarter": quarter,
                        "filing_date": filing_date,
                        "cache_hit": True,
                    },
                )
                results.append(TranscriptResult(
                    ticker=cached["ticker"],
                    quarter=cached["quarter"],
                    filing_date=cached["filing_date"],
                    raw_text=cached["raw_text"],
                    filing_url=cached["filing_url"],
                    parse_status=cached["parse_status"],
                ))
                if cached["parse_status"] == "SUCCESS":
                    transcripts_extracted += 1
                elif cached["parse_status"] == "PRESS_RELEASE":
                    press_releases_extracted += 1
                continue

            # ── Cache miss: proceed with EDGAR fetch ──────────────────────────
            filing_fetch_start = time.monotonic()

            try:
                exhibits = await _get_exhibit_documents(cik, accession_no)
            except EdgarFetchError as exc:
                logger.error(
                    "8-K index fetch failed",
                    extra={"ticker": ticker, "accession_no": accession_no, "status": exc.final_status},
                )
                accession_path = accession_no.replace("-", "")
                results.append(TranscriptResult(
                    ticker=ticker,
                    quarter=quarter,
                    filing_date=filing_date,
                    raw_text="",
                    filing_url=(
                        f"https://www.sec.gov/Archives/edgar/data/{str(int(cik))}"
                        f"/{accession_path}/{accession_no}-index.htm"
                    ),
                    parse_status="FETCH_ERROR",
                ))
                fetch_errors += 1
                logger.info(
                    "transcript cache miss — EDGAR fetch complete",
                    extra={
                        "ticker": ticker,
                        "quarter": quarter,
                        "cache_hit": False,
                        "fetch_duration_ms": int((time.monotonic() - filing_fetch_start) * 1000),
                    },
                )
                continue

            if not exhibits:
                logger.info(
                    "8-K filing skipped",
                    extra={"ticker": ticker, "filing_date": filing_date, "skip_reason": "NO_TRANSCRIPT"},
                )
                skipped_no_transcript += 1
                logger.info(
                    "transcript cache miss — EDGAR fetch complete",
                    extra={
                        "ticker": ticker,
                        "quarter": quarter,
                        "cache_hit": False,
                        "fetch_duration_ms": int((time.monotonic() - filing_fetch_start) * 1000),
                    },
                )
                continue

            # Score all exhibits and pick the best-scoring transcript
            best_text: str | None = None
            best_status: ParseStatus = "NO_TRANSCRIPT"
            best_url = exhibits[0]["url"]

            for exhibit in exhibits:
                try:
                    text, status = await _extract_transcript_text(exhibit["url"], ticker, filing_date)
                except EdgarFetchError as exc:
                    logger.error(
                        "8-K exhibit fetch failed",
                        extra={"ticker": ticker, "url": exhibit["url"], "status": exc.final_status},
                    )
                    if best_status == "NO_TRANSCRIPT":
                        best_status = "FETCH_ERROR"
                        best_url = exhibit["url"]
                    continue
                if status == "SUCCESS":
                    best_text = text
                    best_status = "SUCCESS"
                    best_url = exhibit["url"]
                    break  # first passing transcript wins
                elif status == "PRESS_RELEASE" and best_status == "NO_TRANSCRIPT":
                    best_text = text
                    best_status = "PRESS_RELEASE"
                    best_url = exhibit["url"]
                elif status == "PARSE_FAILURE" and best_status not in ("PRESS_RELEASE",):
                    best_status = "PARSE_FAILURE"
                    best_url = exhibit["url"]

            if best_status == "SUCCESS":
                transcripts_extracted += 1
            elif best_status == "PRESS_RELEASE":
                press_releases_extracted += 1
                logger.info(
                    "8-K press release accepted as transcript fallback",
                    extra={"ticker": ticker, "filing_url": best_url, "filing_date": filing_date},
                )
            elif best_status == "NO_TRANSCRIPT":
                logger.info(
                    "8-K filing skipped",
                    extra={"ticker": ticker, "filing_url": best_url, "filing_date": filing_date, "skip_reason": "NO_TRANSCRIPT"},
                )
                skipped_no_transcript += 1
            elif best_status == "PARSE_FAILURE":
                logger.error(
                    "8-K parse failure",
                    extra={"ticker": ticker, "filing_url": best_url},
                )
                parse_failures += 1
            elif best_status == "FETCH_ERROR":
                fetch_errors += 1

            results.append(TranscriptResult(
                ticker=ticker,
                quarter=quarter,
                filing_date=filing_date,
                raw_text=best_text or "",
                filing_url=best_url,
                parse_status=best_status,
            ))

            if best_status in ("SUCCESS", "PRESS_RELEASE"):
                await insert_transcript(
                    ticker=ticker,
                    quarter=quarter,
                    filing_date=filing_date,
                    raw_text=best_text or "",
                    filing_url=best_url,
                    parse_status=best_status,
                )

            logger.info(
                "transcript cache miss — EDGAR fetch complete",
                extra={
                    "ticker": ticker,
                    "quarter": quarter,
                    "cache_hit": False,
                    "fetch_duration_ms": int((time.monotonic() - filing_fetch_start) * 1000),
                },
            )

    summary = IngestionSummary(
        ticker=ticker,
        date_range_start=start_date,
        date_range_end=end_date,
        total_8k_found=len(filings),
        transcripts_extracted=transcripts_extracted,
        press_releases_extracted=press_releases_extracted,
        skipped_no_transcript=skipped_no_transcript,
        parse_failures=parse_failures,
        fetch_errors=fetch_errors,
        results=results,
    )
    logger.info(
        "8-K ingestion complete",
        extra={
            "ticker": ticker,
            "total_8k_found": summary.total_8k_found,
            "transcripts_extracted": summary.transcripts_extracted,
            "press_releases_extracted": summary.press_releases_extracted,
            "skipped_no_transcript": summary.skipped_no_transcript,
            "parse_failures": summary.parse_failures,
            "fetch_errors": summary.fetch_errors,
        },
    )
    return summary
