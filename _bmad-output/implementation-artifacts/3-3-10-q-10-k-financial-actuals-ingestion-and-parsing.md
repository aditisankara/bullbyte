# Story 3.3: 10-Q/10-K Financial Actuals Ingestion & Parsing

Status: ready-for-dev

## Story

As a **developer**,
I want the ingestion service to fetch and parse 10-Q and 10-K financial actuals from EDGAR for a given ticker and quarter,
So that the verification pipeline has the actual reported figures needed to assess each numerical claim.

## Acceptance Criteria

1. **Given** a valid US ticker and quarter (e.g. `"Q3-2024"`) are provided
   **When** the service fetches the corresponding 10-Q (or 10-K for Q4) filing
   **Then** it retrieves the correct filing via the EDGAR filing index for that ticker and period (FR2)
   **And** the fetch goes through `edgar_client.py` with rate limiting enforced

2. **Given** a 10-Q/10-K filing is fetched
   **When** the parser processes it
   **Then** it extracts available financial line items: revenue, EPS, operating income, gross margin, net income, and any forward guidance figures
   **And** each metric is stored as: `{ ticker, quarter, metric_name, value, unit, section_reference, filing_url, filing_type }`

3. **Given** a metric that cannot be reliably extracted (ambiguous section or non-standard format)
   **When** the parser encounters it
   **Then** it marks that metric `parse_status: "AMBIGUOUS"` and logs the ambiguity with filing URL and section reference
   **And** no guessed or interpolated values are produced

4. **Given** a ticker whose 10-Q is not yet filed for the target quarter
   **When** the ingestion service requests that quarter
   **Then** it returns `status: "FILING_NOT_YET_AVAILABLE"` and logs accordingly without raising an error

## Tasks / Subtasks

- [ ] Task 1: Create `src/models/financials_models.py` (AC: 2, 3, 4)
  - [ ] Define `FinancialMetricStatus` as `Literal["SUCCESS", "AMBIGUOUS", "PARSE_FAILURE", "FETCH_ERROR"]`
  - [ ] Define `FinancialsResultStatus` as `Literal["SUCCESS", "PARTIAL", "FILING_NOT_YET_AVAILABLE", "FETCH_ERROR"]`
  - [ ] Define `FinancialMetric` Pydantic model with fields: `ticker: str`, `quarter: str`, `metric_name: str`, `value: str`, `unit: str`, `section_reference: str`, `filing_url: str`, `filing_type: str`, `parse_status: FinancialMetricStatus`
  - [ ] Define `FinancialsResult` Pydantic model with fields: `ticker: str`, `quarter: str`, `filing_type: str`, `status: FinancialsResultStatus`, `metrics: list[FinancialMetric]`, `filing_url: str`

- [ ] Task 2: Expose `resolve_cik` as a public function in `src/services/ingestion_service.py` (AC: 1)
  - [ ] Rename `_resolve_cik` → `resolve_cik` (remove underscore to make it importable)
  - [ ] Keep `_load_ticker_cik_map`, `_TICKER_CIK_MAP`, and `_cik_map_lock` as private implementation details in `ingestion_service.py`
  - [ ] Update the one internal call site inside `ingestion_service.py` (was `await _resolve_cik(ticker)`, now `await resolve_cik(ticker)`)

- [ ] Task 3: Implement filing-type helper — `_quarter_to_filing_type(quarter)` (AC: 1)
  - [ ] Map Q4-YYYY → `"10-K"`, all other quarters → `"10-Q"`
  - [ ] Parse quarter string: split on `"-"`, check first element is `"Q4"` (case-insensitive)
  - [ ] Implement as pure module-level function (independently unit-testable)

- [ ] Task 4: Implement XBRL company facts fetch — `_fetch_xbrl_facts(cik, ticker)` (AC: 1, 2)
  - [ ] Fetch `https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json` via `get_client().fetch(url, ticker=ticker, filing_type="xbrl-facts")`
  - [ ] Return parsed JSON dict; raise `EdgarFetchError` (handled by caller)
  - [ ] Keep this a thin fetcher — no parsing logic here

- [ ] Task 5: Implement period-end calculator — `_quarter_to_period_end(quarter)` (AC: 1, 2)
  - [ ] Map `"Q1-YYYY"` → `f"{YYYY}-03-31"`, `"Q2-YYYY"` → `f"{YYYY}-06-30"`, `"Q3-YYYY"` → `f"{YYYY}-09-30"`, `"Q4-YYYY"` → `f"{YYYY}-12-31"`
  - [ ] Return ISO date string `"YYYY-MM-DD"`
  - [ ] Implement as pure module-level function

- [ ] Task 6: Implement XBRL metric extractor — `_extract_xbrl_metrics(xbrl_data, ticker, quarter, filing_type)` (AC: 2, 3)
  - [ ] Calculate expected period end via `_quarter_to_period_end(quarter)`
  - [ ] For each metric in `XBRL_METRIC_CONCEPTS`, try each concept in priority order
  - [ ] Match by: `form` matches `filing_type` AND `end` date within ±45 days of expected period end AND entry has `val` key (not empty)
  - [ ] If multiple matches, prefer the one with `end` date closest to expected period end
  - [ ] For 10-K (Q4), match entries where `fp == "FY"` with `fy == year` in addition to date range matching
  - [ ] If concept found: produce `FinancialMetric` with `parse_status: "SUCCESS"`, `section_reference: f"us-gaap/{concept_name}"`, `unit` derived from the units key (e.g. `"USD"`, `"shares"`, `"USD/shares"`)
  - [ ] If multiple concepts match with different values: set `parse_status: "AMBIGUOUS"`, log with ticker, quarter, concept names, values
  - [ ] If no concept found for a metric: skip (do not emit a metric entry for it)
  - [ ] Derive `gross_margin` from `gross_profit / revenue` when both are available; `unit: "ratio"`, `section_reference: "derived:gross_profit/revenue"`
  - [ ] Return `list[FinancialMetric]`

- [ ] Task 7: Implement guidance extractor — `_extract_guidance_from_html(cik, accession_no, ticker, quarter)` (AC: 2, 3)
  - [ ] Derive `accession_path = accession_no.replace("-", "")` and `cik_int = str(int(cik))`
  - [ ] Fetch filing index via `https://www.sec.gov/Archives/edgar/data/{cik_int}/{accession_path}/{accession_no}-index.htm`
  - [ ] Parse index with BeautifulSoup to find the primary 10-Q/10-K document (look for `type == "10-Q"` or `type == "10-K"` in document table, NOT exhibits)
  - [ ] Fetch the primary document URL via `get_client()`
  - [ ] Parse document with `BeautifulSoup(content, "lxml")`
  - [ ] Search for guidance sections: paragraphs or sections containing at least 2 of these keywords (case-insensitive): `"guidance"`, `"outlook"`, `"expects"`, `"anticipates"`, `"full year"`, `"next quarter"`, `"fiscal year"`
  - [ ] For each guidance passage (max 3 passages), extract: value (numeric pattern `r"\$[\d.,]+[BMK]?"` or percentage `r"\d+\.?\d*%"`), surrounding text as summary, section heading as `section_reference`
  - [ ] Produce `FinancialMetric` with `metric_name: f"guidance_{n}"`, `value: <extracted_value_or_passage_summary>`, `unit: "USD"` or `"percent"` as appropriate, `parse_status: "SUCCESS"` if value extracted, `"AMBIGUOUS"` if only text passage
  - [ ] On any `EdgarFetchError`: log at error level, return empty list (guidance extraction is best-effort)
  - [ ] On parse failures: log warning, return empty list

- [ ] Task 8: Implement filing lookup — `_find_filing_accession(cik, ticker, quarter, filing_type)` (AC: 1, 4)
  - [ ] Fetch submissions.json: `https://data.sec.gov/submissions/CIK{cik}.json`
  - [ ] Also fetch paginated files (same large-filer logic as 3.2)
  - [ ] Calculate `period_end = _quarter_to_period_end(quarter)` → expected period end date
  - [ ] Filter for `form == filing_type` and `filingDate` within 180 days after `period_end` (10-Qs are filed within ~45 days; 10-Ks within ~75 days; use 180 days for safety)
  - [ ] Among matches, return the one with `filingDate` closest to `period_end` (the most recent filing for that period)
  - [ ] Return `accession_no: str | None` — `None` means not filed yet → caller sets `FILING_NOT_YET_AVAILABLE`

- [ ] Task 9: Assemble top-level `ingest_financial_actuals(ticker, quarter)` (AC: 1–4)
  - [ ] Resolve CIK via `resolve_cik(ticker)` (imported from `ingestion_service`)
  - [ ] Determine `filing_type = _quarter_to_filing_type(quarter)` — `"10-Q"` or `"10-K"`
  - [ ] Find filing accession via `_find_filing_accession(cik, ticker, quarter, filing_type)`
  - [ ] If no accession found: return `FinancialsResult(status="FILING_NOT_YET_AVAILABLE", metrics=[], filing_url="", ...)` and log with `{ticker, quarter, reason: "no_filing_found"}`
  - [ ] Derive `filing_url`: `f"https://www.sec.gov/Archives/edgar/data/{cik_int}/{accession_path}/{accession_no}-index.htm"`
  - [ ] Fetch XBRL facts via `_fetch_xbrl_facts(cik, ticker)` — catch `EdgarFetchError`: return `FinancialsResult(status="FETCH_ERROR", ...)`
  - [ ] Extract structured metrics via `_extract_xbrl_metrics()`
  - [ ] Extract guidance via `_extract_guidance_from_html()` (best-effort, do NOT fail the whole result)
  - [ ] Combine all metrics into final result
  - [ ] Determine `result.status`: `"SUCCESS"` if at least one metric succeeded, `"PARTIAL"` if some ambiguous, `"FETCH_ERROR"` if no metrics and fetch failed
  - [ ] Log completion: `{ticker, quarter, filing_type, status, metrics_count}`
  - [ ] Return `FinancialsResult`
  - [ ] All EDGAR HTTP calls go through `get_client()` — no direct `httpx` calls in this file

- [ ] Task 10: Write tests `tests/test_financials.py` (AC: 1–4)
  - [ ] Test: `_quarter_to_filing_type("Q1-2024")` returns `"10-Q"`, `_quarter_to_filing_type("Q4-2024")` returns `"10-K"`
  - [ ] Test: `_quarter_to_period_end("Q3-2024")` returns `"2024-09-30"`, `_quarter_to_period_end("Q4-2023")` returns `"2023-12-31"` (parameterized for all 4 quarters)
  - [ ] Test: `_extract_xbrl_metrics()` extracts revenue from `RevenueFromContractWithCustomerExcludingAssessedTax` when present (mock XBRL response)
  - [ ] Test: `_extract_xbrl_metrics()` falls back to `Revenues` when primary revenue concept absent
  - [ ] Test: `_extract_xbrl_metrics()` returns `parse_status: "AMBIGUOUS"` when two revenue concepts return conflicting values for the same period
  - [ ] Test: `_extract_xbrl_metrics()` derives `gross_margin` from `GrossProfit` / revenue when both present
  - [ ] Test: `_extract_xbrl_metrics()` respects ±45 day period-end tolerance (mock entry with `end: "2024-10-05"` matches Q3-2024)
  - [ ] Test: `_find_filing_accession()` returns correct accession for a quarter where a 10-Q exists in submissions mock
  - [ ] Test: `_find_filing_accession()` returns `None` when no matching filing exists (FILING_NOT_YET_AVAILABLE case)
  - [ ] Test: `ingest_financial_actuals()` returns `FinancialsResult(status="FILING_NOT_YET_AVAILABLE")` when `_find_filing_accession` returns `None`
  - [ ] Test: `ingest_financial_actuals()` returns `FinancialsResult(status="FETCH_ERROR")` when XBRL fetch raises `EdgarFetchError`
  - [ ] Test: `ingest_financial_actuals()` returns `FinancialsResult` with metrics list when extraction succeeds (mock XBRL response with known values for TSLA Q3-2024)
  - [ ] Test: guidance extraction failure does NOT prevent overall result from succeeding (mock guidance fetch to raise `EdgarFetchError`, verify metrics still returned)

## Dev Notes

### What This Story Builds

Two new files: `ml-sidecar/src/models/financials_models.py` and `ml-sidecar/src/services/financials_service.py`, plus one modification to `ingestion_service.py` (exposing `resolve_cik` as public).

**Hard scope boundary:** `ingest_financial_actuals()` returns an in-memory `FinancialsResult`. No PostgreSQL writes in this story — DB persistence is story 3.6. Do NOT touch `src/db/pool.py` or `src/db/queries.py`.

This story runs **in parallel with 3.2** per the sprint plan. Story 3.2 is already done — do not modify its logic.

### File Locations (Architecture-Mandated)

```
ml-sidecar/
  src/
    models/
      __init__.py            ← EXISTING — no changes needed
      ingestion_models.py    ← EXISTING — no changes needed
      financials_models.py   ← NEW (this story)
    services/
      ingestion_service.py   ← MODIFIED (rename _resolve_cik → resolve_cik only)
      financials_service.py  ← NEW (this story)
    core/
      edgar_client.py        ← EXISTING — import get_client(), EdgarFetchError only; do NOT modify
      edgar_models.py        ← EXISTING — import EdgarFetchError only; do NOT modify
      logging.py             ← EXISTING — import get_logger() from here
  tests/
    test_ingestion.py        ← EXISTING — do NOT modify (0 regressions required)
    test_financials.py       ← NEW (this story; flat in tests/)
  pyproject.toml             ← NO changes (all deps already present from 3.2)
```

### EDGAR API Endpoints Used

| Purpose | URL Pattern | Notes |
|---|---|---|
| XBRL company facts (all metrics) | `https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json` | Zero-padded CIK; use `ticker=ticker, filing_type="xbrl-facts"` in fetch() call |
| Submissions (filing list) | `https://data.sec.gov/submissions/CIK{cik}.json` | Same as 3.2; used to find accession number |
| Additional filing pages | `https://data.sec.gov/submissions/{filename}` | Same large-filer pagination pattern as 3.2 |
| Filing index HTML | `https://www.sec.gov/Archives/edgar/data/{cik_int}/{accession_path}/{accession_no}-index.htm` | Derive `cik_int = str(int(cik))`, `accession_path = accession_no.replace("-","")` |
| Primary 10-Q/10-K document | `https://www.sec.gov/Archives/edgar/data/{cik_int}/{accession_path}/{doc_filename}` | Found from filing index; for guidance extraction only |

**All requests require User-Agent header — use `get_client().fetch()` always.**

### XBRL Company Facts Response Structure

```python
# GET https://data.sec.gov/api/xbrl/companyfacts/CIK0001318605.json
{
  "cik": "1318605",
  "entityName": "Tesla, Inc.",
  "facts": {
    "us-gaap": {
      "RevenueFromContractWithCustomerExcludingAssessedTax": {
        "label": "Revenue from Contract with Customer...",
        "units": {
          "USD": [
            {
              "end": "2024-09-30",
              "val": 25182000000,
              "accn": "0001318605-24-000086",  # accession number
              "fy": 2024,
              "fp": "Q3",       # Q1/Q2/Q3/FY (relative to fiscal year)
              "form": "10-Q",
              "filed": "2024-10-23"
            }
          ]
        }
      },
      "EarningsPerShareDiluted": {
        "units": {
          "USD/shares": [...]  # unit key is the unit string for the metric
        }
      }
    }
  }
}
```

### XBRL Metric Concept Priority Map

Define at module level in `financials_service.py`:

```python
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
}
# gross_margin is derived from gross_profit / revenue — not in this map
```

### Quarter → Period End Date Mapping

```python
def _quarter_to_period_end(quarter: str) -> str:
    """Map 'Q3-2024' to approximate calendar period end date for XBRL matching."""
    parts = quarter.split("-")
    q_num = int(parts[0][1])   # 1-4
    year = int(parts[1])
    ends = {1: f"{year}-03-31", 2: f"{year}-06-30", 3: f"{year}-09-30", 4: f"{year}-12-31"}
    return ends[q_num]
```

**Period-end tolerance:** ±45 days. This handles fiscal-year companies whose quarter end dates don't align with calendar quarters. Example: Apple (AAPL) fiscal Q1 ends in late December, fiscal Q2 ends late March — both within 45 days of calendar equivalents.

### Quarter → Filing Type

```python
def _quarter_to_filing_type(quarter: str) -> str:
    """Return '10-K' for Q4, '10-Q' for Q1/Q2/Q3."""
    return "10-K" if quarter.upper().startswith("Q4") else "10-Q"
```

### Q4 / 10-K Handling

For Q4, the 10-K is the annual report. XBRL entries for annual figures have `fp == "FY"` and `form == "10-K"`. Some companies also file 10-K with quarterly breakdowns; prefer `fp == "FY"` entries.

**Important:** Match 10-K entries with `fy == int(year)` from the quarter string in addition to the ±45 day date check, since `fp == "FY"` covers the entire fiscal year.

### Gross Margin Derivation

```python
# After extracting revenue and gross_profit metrics:
if revenue_metric and gross_profit_metric:
    try:
        margin = float(gross_profit_metric.value) / float(revenue_metric.value)
        metrics.append(FinancialMetric(
            ...,
            metric_name="gross_margin",
            value=f"{margin:.4f}",
            unit="ratio",
            section_reference="derived:gross_profit/revenue",
            parse_status="SUCCESS",
        ))
    except (ValueError, ZeroDivisionError):
        pass  # skip silently — no metric created
```

### Filing Lookup in Submissions JSON

Same submission JSON structure as 3.2. For 10-Q/10-K lookup:

```python
# Filter condition: form matches AND filingDate is within 180 days after period_end
# Rationale: 10-Qs are due 40 days after quarter end (large filers), 10-Ks 60 days
# Use 180 days as a wide safety margin
from datetime import datetime, timedelta

period_end_dt = datetime.strptime(period_end, "%Y-%m-%d")
cutoff_dt = period_end_dt + timedelta(days=180)

matches = [
    entry for entry in entries
    if entry["form"] == filing_type
    and period_end_dt <= datetime.strptime(entry["filingDate"], "%Y-%m-%d") <= cutoff_dt
]
# Return accession_no of the match with the earliest filingDate (closest to period end)
```

### resolve_cik Import Pattern

`financials_service.py` imports the shared CIK resolution from `ingestion_service.py`. This reuses the already-populated `_TICKER_CIK_MAP` cache — no duplicate EDGAR fetch:

```python
# financials_service.py
from src.services.ingestion_service import resolve_cik  # shared CIK cache
```

In `ingestion_service.py`, only rename the function: `async def resolve_cik(ticker: str) -> str:` (was `_resolve_cik`). The cache and lock stay private. Update the one internal call site in `ingest_8k_transcripts()`.

### No New Dependencies

All required packages are already in `pyproject.toml` from story 3.2:
- `beautifulsoup4>=4.14.3` — for guidance HTML parsing
- `lxml>=6.1.1` — BeautifulSoup parser  
- `httpx>=0.28.1` — via edgar_client
- `pydantic>=2.13.3` — for models

Do NOT run `uv add` or modify `pyproject.toml`.

### Structured Logging Pattern

Follow exactly the pattern from `edgar_client.py` and `ingestion_service.py`:

```python
from src.core.logging import get_logger
logger = get_logger("ml-sidecar.financials_service")

logger.info("financial actuals ingestion complete", extra={
    "ticker": ticker,
    "quarter": quarter,
    "filing_type": filing_type,
    "status": result.status,
    "metrics_count": len(result.metrics),
})

logger.warning("AMBIGUOUS metric — skipping", extra={
    "ticker": ticker,
    "quarter": quarter,
    "metric_name": metric_name,
    "concept": concept_name,
    "filing_url": filing_url,
    "section_reference": section_ref,
})

logger.info("10-Q not yet filed", extra={
    "ticker": ticker,
    "quarter": quarter,
    "reason": "no_filing_found",
})
```

### Test Mock Pattern

Follow `test_ingestion.py` exactly:

```python
# tests/test_financials.py
from unittest.mock import AsyncMock, MagicMock, patch
import httpx
import pytest
import src.services.ingestion_service as ingestion_svc

# Reset CIK cache between tests (same module as 3.2)
@pytest.fixture(autouse=True)
def reset_cik_cache():
    ingestion_svc._TICKER_CIK_MAP = {}
    yield
    ingestion_svc._TICKER_CIK_MAP = {}

@pytest.fixture
def mock_client():
    with patch("src.services.financials_service.get_client") as mock_factory:
        client = MagicMock()
        client.fetch = AsyncMock()
        mock_factory.return_value = client
        yield client
```

**Important:** The mock patches `src.services.financials_service.get_client` (not `ingestion_service.get_client`). The `resolve_cik` import means `_load_ticker_cik_map` will call `get_client()` from `ingestion_service` — patch that separately if testing CIK resolution in financials tests.

For XBRL mock response, build a minimal dict matching the XBRL structure:

```python
MOCK_XBRL = {
    "facts": {
        "us-gaap": {
            "RevenueFromContractWithCustomerExcludingAssessedTax": {
                "units": {
                    "USD": [
                        {"end": "2024-09-30", "val": 25182000000, "form": "10-Q", "fp": "Q3", "fy": 2024, "filed": "2024-10-23", "accn": "0001-24-001"}
                    ]
                }
            },
            "EarningsPerShareDiluted": {
                "units": {
                    "USD/shares": [
                        {"end": "2024-09-30", "val": 0.72, "form": "10-Q", "fp": "Q3", "fy": 2024, "filed": "2024-10-23", "accn": "0001-24-001"}
                    ]
                }
            }
        }
    }
}
mock_client.fetch.return_value = httpx.Response(200, json=MOCK_XBRL)
```

### Does Not Touch

- `src/main.py` — no new router registered (financials_service is an internal library, not an HTTP route)
- `src/routers/analysis_router.py` — stub unchanged
- `src/db/pool.py`, `src/db/queries.py` — no DB writes in this story
- `src/core/edgar_client.py` — import only; do NOT modify
- `src/core/edgar_models.py` — import only; do NOT modify
- `ml-sidecar/tests/test_ingestion.py` — do NOT modify; 51 tests must still pass

### Key Invariants

- Quarter format `"Q{n}-{YYYY}"` — architecture canonical enum. Never `"2024Q3"` or `"Q3 2024"`.
- `value` field in `FinancialMetric` is always a string (not float/int). Downstream consumers handle parsing.
- `parse_status: "AMBIGUOUS"` is used for metrics where the extraction is uncertain — never guessed values.
- `gross_margin` is derived, not directly fetched. Only produce it if both `gross_profit` and `revenue` successfully extracted.
- XBRL facts file can be several MB — fetch once, extract all metrics from the single response.
- `FILING_NOT_YET_AVAILABLE` is a result-level status, not a metric-level status.

### References

- [Source: epics.md — Story 3.3: acceptance criteria and Epic 3 context]
- [Source: architecture.md — FastAPI Project Structure: `src/services/`, `src/models/`]
- [Source: architecture.md — NFR9, NFR10, NFR16; Canonical Enums (Quarter format, SCREAMING_SNAKE_CASE); Logging Guidelines]
- [Source: _bmad-output/implementation-artifacts/3-2-8-k-earnings-call-transcript-ingestion-and-parsing.md — resolve_cik pattern, mock_client fixture, logger pattern, BeautifulSoup usage, accession_path derivation, cik_int derivation, large-filer pagination, EdgarFetchError handling]
- [EDGAR XBRL API Docs: https://www.sec.gov/edgar/sec-api-documentation — companyfacts endpoint]

## Dev Agent Record

### Agent Model Used

<!-- to be filled in by dev agent -->

### Debug Log References

### Completion Notes List

### File List
