# Story 3.2: 8-K Earnings Call Transcript Ingestion & Parsing

Status: ready-for-dev

## Story

As a **developer**,
I want the ingestion service to fetch and parse 8-K earnings call transcripts from EDGAR for a given ticker and date range,
So that the extraction pipeline has structured transcript text for every supported quarter.

## Acceptance Criteria

1. **Given** a valid US ticker and date range are provided to `ingestion_service.py`
   **When** the service searches EDGAR for 8-K filings
   **Then** it retrieves the list of 8-K filing URLs for that ticker within the range
   **And** each filing URL is fetched via `edgar_client.py` respecting rate limits (FR1)

2. **Given** an 8-K filing is fetched
   **When** the parser processes it
   **Then** it extracts the earnings call transcript text and structures it as: `{ ticker, quarter, filing_date, raw_text, filing_url, parse_status }`
   **And** if the filing does not contain a transcript it is skipped with a log entry noting the skip reason

3. **Given** a filing that cannot be parsed due to unexpected format
   **When** the parser encounters the format
   **Then** it sets `parse_status: "PARSE_FAILURE"` and logs the failure with the filing URL
   **And** it does not raise an exception that halts the entire ingestion run — other filings continue processing

4. **Given** the 5 demo tickers (TSLA, AAPL, SPOT, META, NVDA) over the last 8 quarters
   **When** ingestion runs for each
   **Then** at least one 8-K transcript is retrieved and parsed successfully per ticker per available quarter

## Tasks / Subtasks

- [ ] Task 1: Add new dependencies to pyproject.toml (AC: 1, 2)
  - [ ] Add `beautifulsoup4>=4.13.0` to `[project] dependencies` via `uv add beautifulsoup4`
  - [ ] Add `lxml>=5.0.0` to `[project] dependencies` via `uv add lxml`
  - [ ] Run `uv sync` to update `uv.lock`

- [ ] Task 2: Create `src/models/__init__.py` and `src/models/ingestion_models.py` (AC: 2)
  - [ ] Create `src/models/` directory with empty `__init__.py`
  - [ ] Define `ParseStatus` as a `Literal` type: `Literal["SUCCESS", "PARSE_FAILURE", "NO_TRANSCRIPT", "FETCH_ERROR"]`
  - [ ] Define `TranscriptResult` Pydantic model with fields: `ticker: str`, `quarter: str`, `filing_date: str`, `raw_text: str`, `filing_url: str`, `parse_status: ParseStatus`
  - [ ] Define `IngestionSummary` Pydantic model with fields: `ticker: str`, `date_range_start: str`, `date_range_end: str`, `total_8k_found: int`, `transcripts_extracted: int`, `skipped_no_transcript: int`, `parse_failures: int`, `results: list[TranscriptResult]`

- [ ] Task 3: Implement ticker-to-CIK resolution in `src/services/ingestion_service.py` (AC: 1)
  - [ ] Fetch `https://www.sec.gov/files/company_tickers.json` via `get_client().fetch(url, ticker="system", filing_type="tickers")`
  - [ ] Parse response JSON to build `{ TICKER_UPPER: cik_zero_padded_10_digits }` dict (e.g. `"TSLA": "0001318605"`)
  - [ ] Cache the mapping as a module-level dict `_TICKER_CIK_MAP`; refresh only on startup (never re-fetch per request)
  - [ ] Raise `ValueError(f"Ticker {ticker!r} not found in EDGAR company index")` if ticker not in map

- [ ] Task 4: Implement EDGAR 8-K filing discovery — `_get_8k_filings(cik, start_date, end_date)` (AC: 1)
  - [ ] Fetch submissions: `https://data.sec.gov/submissions/CIK{cik}.json` via `get_client().fetch()`
  - [ ] Zip parallel arrays `accessionNumber`, `filingDate`, `form` from `filings.recent` into per-filing dicts
  - [ ] Filter: `form == "8-K"` and `start_date <= filingDate <= end_date` (ISO string comparison)
  - [ ] Handle large filers: if `filings.files` is non-empty, fetch each additional page from `https://data.sec.gov/submissions/{filename}` and append its `filings.recent` entries
  - [ ] Return `list[dict]` of `{ accession_no: str, filing_date: str }` sorted by `filing_date` ascending

- [ ] Task 5: Implement filing index fetch — `_get_exhibit_documents(cik, accession_no)` (AC: 1, 2)
  - [ ] Derive URL: accession_no without dashes for path, e.g. `"0001318605-24-000123"` → path `"000131860524000123"`, index URL `https://www.sec.gov/Archives/edgar/data/{cik}/{path}/{accession_no}-index.htm`
  - [ ] Fetch index via `get_client().fetch()`
  - [ ] Parse HTML with BeautifulSoup; extract document table rows as `{ type: str, description: str, document: str }` where `document` is the filename
  - [ ] Construct full document URL: `https://www.sec.gov/Archives/edgar/data/{cik}/{path}/{document}`
  - [ ] Return only rows where `type` starts with `"EX-99"` or `description` contains `"transcript"` (case-insensitive); return empty list if none

- [ ] Task 6: Implement transcript text extraction — `_extract_transcript_text(url, ticker, filing_date)` (AC: 2, 3)
  - [ ] Fetch document via `get_client().fetch(url, ticker=ticker, filing_type="8-K-exhibit")`
  - [ ] Score keyword hits in the first 8,000 characters of response text (case-insensitive): `"operator"`, `"conference call"`, `"earnings call"`, `"q&a"`, `"fiscal quarter"`, `"per share"`, `"revenue"` — count unique keyword matches
  - [ ] If keyword score < 3: return `None` (caller marks as `NO_TRANSCRIPT`)
  - [ ] Parse full response content with `BeautifulSoup(content, "lxml").get_text(separator="\n", strip=True)`; collapse runs of 3+ blank lines to 2 blank lines
  - [ ] Wrap in `try/except Exception`; on any exception log at `error` level and return `None` with a `PARSE_FAILURE` indicator

- [ ] Task 7: Implement quarter mapping — `_filing_date_to_quarter(filing_date)` (AC: 2)
  - [ ] Map `filing_date` (ISO string `"YYYY-MM-DD"`) to earnings quarter:
    - Month 1–3 → `f"Q4-{year-1}"`
    - Month 4–6 → `f"Q1-{year}"`
    - Month 7–9 → `f"Q2-{year}"`
    - Month 10–12 → `f"Q3-{year}"`
  - [ ] Return in canonical format `"Q{n}-{YYYY}"` — never any other representation (architecture canonical enum)
  - [ ] Implement as a pure module-level function (independently unit-testable)

- [ ] Task 8: Assemble top-level `ingest_8k_transcripts(ticker, start_date, end_date)` (AC: 1–4)
  - [ ] Orchestrate: CIK lookup → `_get_8k_filings()` → for each filing: `_get_exhibit_documents()` → for each exhibit: `_extract_transcript_text()`
  - [ ] Map results to `TranscriptResult` objects with correct `parse_status` (`"SUCCESS"`, `"NO_TRANSCRIPT"`, `"PARSE_FAILURE"`, `"FETCH_ERROR"`)
  - [ ] Catch `EdgarFetchError` from any fetch call: set `parse_status: "FETCH_ERROR"`, log, continue — never propagate
  - [ ] Return `IngestionSummary` with full `results` list and accurate counts
  - [ ] Log completion with structured entry: `ticker`, `total_8k_found`, `transcripts_extracted`, `skipped_no_transcript`, `parse_failures`
  - [ ] All EDGAR HTTP calls go through `get_client().fetch()` — no direct `httpx` calls in this file

- [ ] Task 9: Write tests `tests/test_ingestion.py` (AC: 1–4)
  - [ ] Test: `_load_ticker_cik_map()` returns correct zero-padded CIK for `"TSLA"` (mock response JSON)
  - [ ] Test: unknown ticker raises `ValueError` with message containing the ticker symbol
  - [ ] Test: `_get_8k_filings()` filters correctly — returns only 8-K within date range, excludes 8-K/A and out-of-range dates (mock submissions JSON)
  - [ ] Test: `_get_8k_filings()` handles large filer pagination — fetches additional file and appends results (mock two submissions pages)
  - [ ] Test: `_get_exhibit_documents()` parses filing index HTML and returns EX-99 documents with full URLs
  - [ ] Test: `_extract_transcript_text()` returns `None` when keyword score < 3 (non-transcript 8-K)
  - [ ] Test: `_extract_transcript_text()` returns cleaned text when keyword score ≥ 3
  - [ ] Test: `_extract_transcript_text()` on malformed HTML raises no exception — returns `None` indicating parse failure
  - [ ] Test: `_filing_date_to_quarter()` correct for all 12 months across year boundary (parameterized: Jan 2024 → Q4-2023, Apr 2024 → Q1-2024, etc.)
  - [ ] Test: `ingest_8k_transcripts()` returns `IngestionSummary` with correct counts when mix of SUCCESS / NO_TRANSCRIPT / FETCH_ERROR results
  - [ ] Test: `EdgarFetchError` on one filing does not halt processing — remaining filings continue and appear in results

## Dev Notes

### What This Story Builds

`ml-sidecar/src/services/ingestion_service.py` and its Pydantic models in `src/models/ingestion_models.py`. This story covers **8-K transcript fetching and in-memory parsing only** — 10-Q/10-K actuals (3.3), DB caching (3.6), and temporal alignment (3.4) are separate stories.

**Hard scope boundary:** `ingest_8k_transcripts()` returns an in-memory `IngestionSummary`. No PostgreSQL writes in this story — do NOT touch `src/db/pool.py` or `src/db/queries.py`. DB persistence is added in story 3.6.

### File Locations (Architecture-Mandated)

```
ml-sidecar/
  src/
    models/
      __init__.py          ← NEW (first use of this directory — create it)
      ingestion_models.py  ← NEW (this story)
    services/
      ingestion_service.py ← NEW (this story)
    core/
      edgar_client.py      ← EXISTING — import get_client(), EdgarFetchError only
      edgar_models.py      ← EXISTING — do NOT modify
      logging.py           ← EXISTING — import get_logger() from here
  tests/
    test_ingestion.py      ← NEW (this story; flat in tests/, no subdirectory)
  pyproject.toml           ← MODIFIED (add beautifulsoup4, lxml)
  uv.lock                  ← MODIFIED (uv sync)
```

**Note on `src/models/` vs `src/core/`:** Story 3.1 placed `EdgarFetchError/EdgarFetchLog` in `src/core/edgar_models.py` because they're tightly coupled to the edgar_client core module. Ingestion-specific models (`TranscriptResult`, `IngestionSummary`) are request/response shapes, which the architecture places in `src/models/`. Follow the architecture spec here — `src/models/` is the correct location.

### EDGAR API Endpoints (All Require User-Agent Header via `edgar_client`)

| Purpose | URL Pattern | Notes |
|---|---|---|
| Ticker→CIK map | `https://www.sec.gov/files/company_tickers.json` | Fetch once at startup, cache module-level |
| Submissions (filing list) | `https://data.sec.gov/submissions/CIK{cik}.json` | CIK zero-padded to 10 digits: `CIK0001318605.json` |
| Additional filing pages | `https://data.sec.gov/submissions/{filename}` | Only for large filers (AAPL, MSFT, etc.) |
| Filing index HTML | `https://www.sec.gov/Archives/edgar/data/{cik}/{accession_path}/{accession_dashes}-index.htm` | Lists all docs in filing |
| Filing document | `https://www.sec.gov/Archives/edgar/data/{cik}/{accession_path}/{docname}` | The actual HTML/text |

**Accession number transformation:**
```python
# Input from submissions JSON: "0001318605-24-000123"
accession_dashes = "0001318605-24-000123"
accession_path = accession_dashes.replace("-", "")  # "000131860524000123"
```

### Submissions JSON Structure

```python
# Response from data.sec.gov/submissions/CIK0001318605.json
{
  "cik": "1318605",
  "filings": {
    "recent": {
      "accessionNumber": ["0001318605-24-000123", "0001318605-24-000456"],  # parallel arrays
      "filingDate":      ["2024-10-23",            "2024-08-01"],
      "form":            ["8-K",                   "10-Q"],
    },
    "files": [  # non-empty for large filers like AAPL — fetch each to get full history
      {"name": "CIK0000320193-submissions-001.json", ...}
    ]
  }
}
```

### company_tickers.json Structure

```python
# Response from www.sec.gov/files/company_tickers.json
{
  "0": {"cik_str": 1318605, "ticker": "TSLA", "title": "Tesla, Inc."},
  "1": {"cik_str": 320193, "ticker": "AAPL", "title": "Apple Inc."},
  ...
}
```

Build `_TICKER_CIK_MAP = {entry["ticker"].upper(): f"{entry['cik_str']:010d}" for entry in data.values()}`.

### New Dependencies

```toml
# pyproject.toml after changes
[project]
dependencies = [
    "anthropic>=0.100.0",
    "asyncpg>=0.30.0",
    "beautifulsoup4>=4.13.0",   # new — HTML parsing for 8-K documents
    "fastapi>=0.136.1",
    "httpx>=0.28.1",
    "lxml>=5.0.0",              # new — fast BeautifulSoup parser
    "openai>=2.36.0",
    "pydantic>=2.13.3",
    "python-json-logger>=4.1.0",
    "tenacity>=9.0.0",
    "uvicorn>=0.46.0",
]
```

### Quarter Mapping

```python
from datetime import datetime

def _filing_date_to_quarter(filing_date: str) -> str:
    """Map 8-K filing date to the earnings quarter it reports."""
    dt = datetime.strptime(filing_date, "%Y-%m-%d")
    m, y = dt.month, dt.year
    if m <= 3:   return f"Q4-{y - 1}"
    if m <= 6:   return f"Q1-{y}"
    if m <= 9:   return f"Q2-{y}"
    return           f"Q3-{y}"
```

Quarter format: `"Q{n}-{YYYY}"` — always. Never `"2024Q3"`, `"Q3 2024"`, or any other format. This is an architecture-mandated canonical enum.

### Transcript Identification

Not all 8-Ks contain earnings call transcripts. Strategy:
1. From the filing index, collect all documents where `type` starts with `"EX-99"` or `description` contains `"transcript"`
2. For each candidate, fetch and score keyword hits in the first 8,000 characters
3. Keywords (count unique matches): `"operator"`, `"conference call"`, `"earnings call"`, `"q&a"`, `"fiscal quarter"`, `"per share"`, `"revenue"`
4. Threshold ≥ 3 unique keywords → treat as transcript
5. If multiple documents pass: pick highest-scoring one
6. If none pass: `parse_status = "NO_TRANSCRIPT"`, log, continue

### BeautifulSoup Usage

```python
from bs4 import BeautifulSoup

# Extract all text from HTML
soup = BeautifulSoup(html_content, "lxml")
text = soup.get_text(separator="\n", strip=True)

# Parse filing index table
soup = BeautifulSoup(index_html, "lxml")
rows = soup.select("table tr")
```

### Structured Logging Pattern

Follow exactly the pattern from `edgar_client.py` — `get_logger()` from `src.core.logging`, fields via `extra={}`:

```python
from src.core.logging import get_logger
logger = get_logger("ml-sidecar.ingestion_service")

logger.info("8-K filing skipped", extra={
    "ticker": ticker,
    "filing_url": filing_url,
    "filing_date": filing_date,
    "skip_reason": "NO_TRANSCRIPT",
})

logger.error("8-K parse failure", extra={
    "ticker": ticker,
    "filing_url": filing_url,
    "error": str(exc),
})

logger.info("8-K ingestion complete", extra={
    "ticker": ticker,
    "total_8k_found": total,
    "transcripts_extracted": extracted,
    "skipped_no_transcript": skipped,
    "parse_failures": failures,
})
```

### Key Patterns from Story 3.1 (Follow These)

- **Use `get_client()`** from `src.core.edgar_client` — never instantiate `EdgarClient` directly
- **`EdgarFetchError`** is what you catch when a fetch fails — import from `src.core.edgar_models`
- **Module-level logger:** `logger = get_logger("ml-sidecar.ingestion_service")` at top of file
- **pytest-asyncio** already configured (`asyncio_mode = "auto"`) — all async test functions work without decorator
- **`monkeypatch.setenv()`** for env vars in tests
- **Mock `get_client()`** in tests, not `edgar_client.fetch()` directly — mock the singleton return value

### Test Mock Pattern

```python
# tests/test_ingestion.py
from unittest.mock import AsyncMock, MagicMock, patch
import httpx
import pytest

@pytest.fixture
def mock_edgar_client():
    with patch("src.services.ingestion_service.get_client") as mock_factory:
        client = MagicMock()
        client.fetch = AsyncMock()
        mock_factory.return_value = client
        yield client

async def test_cik_lookup(mock_edgar_client, monkeypatch):
    monkeypatch.setenv("EDGAR_USER_AGENT", "BullByte/1.0 test@example.com")
    mock_edgar_client.fetch.return_value = httpx.Response(
        200,
        json={"0": {"cik_str": 1318605, "ticker": "TSLA", "title": "Tesla Inc"}}
    )
    # test CIK resolution ...
```

Reset the `_TICKER_CIK_MAP` module-level cache between tests if needed:
```python
import src.services.ingestion_service as svc
svc._TICKER_CIK_MAP = {}  # reset cache
```

### Does Not Touch

- `src/main.py` — no new router registered (ingestion_service is an internal library, not an HTTP route)
- `src/routers/analysis_router.py` — stub remains unchanged
- `src/db/pool.py`, `src/db/queries.py` — no DB writes in this story
- `src/core/edgar_client.py` — import only; do NOT modify
- `src/core/edgar_models.py` — import only; do NOT modify

### References

- [Source: architecture.md — FastAPI Project Structure: `src/services/ingestion_service.py`, `src/models/`]
- [Source: architecture.md — NFR9, NFR10, NFR16; Logging Guidelines]
- [Source: epics.md — Story 3.2: full acceptance criteria and Epic 3 context]
- [Source: _bmad-output/implementation-artifacts/3-1-edgar-http-client-with-rate-limiting-queue.md — EdgarClient interface, test patterns, singleton factory pattern]
- [Source: architecture.md — Canonical Enums: Quarter format "Q3-2024"]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

## Change Log
