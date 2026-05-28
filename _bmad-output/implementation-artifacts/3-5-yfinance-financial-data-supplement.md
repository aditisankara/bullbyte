# Story 3.5: yfinance Financial Data Supplement

Status: ready-for-dev

## Story

As a **developer**,
I want the ingestion service to supplement EDGAR financial actuals with yfinance data where EDGAR parsing is ambiguous or incomplete,
So that the verification pipeline has the broadest possible set of financial figures within portfolio-scale usage limits.

## Acceptance Criteria

1. **Given** a ticker and quarter where EDGAR parsing returned `AMBIGUOUS` or missing metrics
   **When** `ingest_financial_actuals` calls the yfinance supplement
   **Then** it retrieves available financial figures for that ticker and quarter (FR6)
   **And** each yfinance-sourced value is tagged `source: "yfinance"` — never presented as EDGAR-sourced

2. **Given** any yfinance call
   **When** the call completes (success or failure)
   **Then** a structured log entry is emitted with: `ticker`, `quarter`, `metrics_requested`, `metrics_returned`, `source: "yfinance"`, `timestamp`
   **And** yfinance failures do not halt the ingestion run — the metric is marked unavailable

3. **Given** yfinance is used for a given metric
   **When** the verification pipeline reads that metric
   **Then** the `source: "yfinance"` tag is preserved through to the verdict's reasoning trace (NFR19)

## Tasks / Subtasks

- [ ] Task 1: Add `source` field to `FinancialMetric` in `src/models/financials_models.py` (AC: 1, 3)
  - [ ] Add `source: Literal["edgar", "yfinance"] = "edgar"` to `FinancialMetric` — default `"edgar"` preserves backward compatibility for all existing EDGAR-sourced metrics
  - [ ] No other changes to `financials_models.py`; existing tests must still pass with the new default

- [ ] Task 2: Add `yfinance` dependency to `pyproject.toml` (AC: 1, 2)
  - [ ] Run `uv add "yfinance>=0.2.50"` inside the `ml-sidecar/` directory
  - [ ] Verify `yfinance` appears in `pyproject.toml` `[project] dependencies`

- [ ] Task 3: Create `src/services/yfinance_service.py` (AC: 1, 2, 3)
  - [ ] Implement `_quarter_to_period_end_date(quarter: str) -> datetime.date` — reuse the same mapping logic as `financials_service.py` (`Q1→03-31`, `Q2→06-30`, `Q3→09-30`, `Q4→12-31`); raises `ValueError` on invalid input
  - [ ] Implement `_fetch_yfinance_ticker(ticker: str) -> yf.Ticker` as a sync helper called via executor (no direct `yf.Ticker()` call outside of executor)
  - [ ] Implement `_get_quarterly_df(ticker_obj: yf.Ticker) -> pd.DataFrame` — returns `ticker_obj.quarterly_income_stmt` (synchronous, called inside executor)
  - [ ] Implement `_extract_yfinance_metrics(ticker: str, quarter: str, df: pd.DataFrame, metrics_needed: list[str]) -> list[FinancialMetric]`
    - Map `metrics_needed` names to DataFrame row labels: `{"revenue": "Total Revenue", "eps_basic": "Basic EPS", "eps_diluted": "Diluted EPS", "operating_income": "Operating Income", "gross_profit": "Gross Profit", "net_income": "Net Income"}`
    - Match quarter to DataFrame column: find column (a `pd.Timestamp`) where `|column.date() - _quarter_to_period_end_date(quarter)| <= 45 days`; use the closest matching column
    - For each matched metric: create `FinancialMetric(ticker=ticker, quarter=quarter, metric_name=name, value=str(float(df.loc[row_label, col])), unit="USD", section_reference=f"yfinance/{row_label}", filing_url="", filing_type="yfinance", parse_status="SUCCESS", source="yfinance")`
    - If no column matches the quarter → return empty list (no partial data)
    - Skip row labels missing from DataFrame (KeyError) silently — do not raise
    - Skip NaN values silently
  - [ ] Implement public entry point `async def supplement_with_yfinance(ticker: str, quarter: str, metrics_needed: list[str]) -> list[FinancialMetric]`
    - Run all sync yfinance calls via `await asyncio.get_event_loop().run_in_executor(None, ...)` — never block the event loop
    - Log before: `logger.info("yfinance supplement start", extra={"ticker": ticker, "quarter": quarter, "metrics_requested": metrics_needed, "source": "yfinance", "timestamp": ...})`
    - Wrap entire fetch+extract in `try/except Exception` — on any failure, log error and return `[]`
    - Log after (success): `logger.info("yfinance supplement complete", extra={"ticker": ticker, "quarter": quarter, "metrics_requested": metrics_needed, "metrics_returned": [m.metric_name for m in results], "source": "yfinance", "timestamp": ...})`
    - Log after (failure): `logger.error("yfinance supplement failed", extra={"ticker": ticker, "quarter": quarter, "metrics_requested": metrics_needed, "metrics_returned": [], "source": "yfinance", "timestamp": ..., "error": str(exc)})`
    - Return `[]` on any exception — never raises (AC2: failures do not halt ingestion)

- [ ] Task 4: Integrate supplement into `src/services/financials_service.py` (AC: 1, 2)
  - [ ] Import `supplement_with_yfinance` from `src.services.yfinance_service`
  - [ ] After `_extract_xbrl_metrics` and guidance extraction in `ingest_financial_actuals`, identify which metrics need supplementing:
    - `AMBIGUOUS_OR_MISSING` = metrics where `parse_status == "AMBIGUOUS"` PLUS metric names from `XBRL_METRIC_CONCEPTS` that produced no metric at all
    - Only call `supplement_with_yfinance` if `AMBIGUOUS_OR_MISSING` is non-empty
  - [ ] Merge yfinance results: for each yfinance metric, only add it if no EDGAR metric with the same `metric_name` already has `parse_status == "SUCCESS"` — yfinance supplements, never replaces a clean EDGAR value
  - [ ] The existing `result_status` logic runs AFTER yfinance merge — a metric successfully supplemented by yfinance (`source="yfinance"`, `parse_status="SUCCESS"`) counts toward clearing `PARTIAL` status
  - [ ] Do NOT change the function signature of `ingest_financial_actuals`

- [ ] Task 5: Write tests `tests/test_yfinance_service.py` (AC: 1, 2, 3)
  - [ ] Test: `supplement_with_yfinance("TSLA", "Q3-2024", ["revenue", "net_income"])` returns list of `FinancialMetric` with `source="yfinance"` and `parse_status="SUCCESS"` (mock `run_in_executor` to return a mock DataFrame)
  - [ ] Test: every returned metric has `source="yfinance"` — none have `source="edgar"`
  - [ ] Test: `supplement_with_yfinance` returns `[]` when yfinance raises any exception (mock executor to raise `Exception("network error")`) — does NOT re-raise (AC2)
  - [ ] Test: structured log is emitted with `ticker`, `quarter`, `metrics_requested`, `metrics_returned`, `source: "yfinance"`, `timestamp` on both success and failure paths (use `caplog`)
  - [ ] Test: `_extract_yfinance_metrics` returns `[]` when no DataFrame column is within 45-day window of the quarter
  - [ ] Test: `_extract_yfinance_metrics` skips NaN values silently
  - [ ] Test: `_extract_yfinance_metrics` skips missing row labels silently (KeyError in DataFrame)
  - [ ] Test: `_quarter_to_period_end_date("Q1-2024")` → `date(2024, 3, 31)`, all 4 quarters (parameterized)
  - [ ] Test: `_quarter_to_period_end_date` raises `ValueError` on bad input (e.g. `"Q5-2024"`, `"bad"`)

- [ ] Task 6: Verify pre-existing tests still pass
  - [ ] Run all tests in `tests/` — all pre-existing tests must pass with 0 regressions
  - [ ] The added `source` field default `"edgar"` must not break `test_financials.py` assertions (none check `source` explicitly, but Pydantic model dicts will now include it)

## Dev Notes

### What This Story Builds

Four file changes:
- `ml-sidecar/src/models/financials_models.py` — UPDATE: add `source` field to `FinancialMetric`
- `ml-sidecar/pyproject.toml` — UPDATE: add `yfinance>=0.2.50`
- `ml-sidecar/src/services/yfinance_service.py` — NEW: async yfinance supplement service
- `ml-sidecar/src/services/financials_service.py` — UPDATE: integrate yfinance supplement call
- `ml-sidecar/tests/test_yfinance_service.py` — NEW: tests for yfinance service

### Hard Scope Boundaries

- **No PostgreSQL writes** — return `FinancialMetric` objects in-memory. DB persistence is story 3.6.
- **No modifications to `ingestion_service.py`** — yfinance supplement is at the financials layer, not transcript ingestion.
- **No modifications to `temporal_aligner.py`** — not in scope.
- **yfinance only supplements, never replaces** — if EDGAR produced a `SUCCESS` metric for a given name, yfinance does NOT overwrite it. Only add yfinance values for `AMBIGUOUS` or completely missing metrics.
- **portfolio-scale only** — yfinance calls are per-ticker per-quarter, no bulk downloads. Do NOT use `yf.download()`.
- **No new error types** — yfinance failures return `[]`; never raise to caller.

### Critical: FinancialMetric Model Update

Add `source` field with default `"edgar"` for backward compatibility:

```python
from typing import Literal
from pydantic import BaseModel

FinancialMetricStatus = Literal["SUCCESS", "AMBIGUOUS", "PARSE_FAILURE", "FETCH_ERROR"]
FinancialMetricSource = Literal["edgar", "yfinance"]
FinancialsResultStatus = Literal["SUCCESS", "PARTIAL", "FILING_NOT_YET_AVAILABLE", "FETCH_ERROR"]

class FinancialMetric(BaseModel):
    ticker: str
    quarter: str
    metric_name: str
    value: str
    unit: str
    section_reference: str
    filing_url: str
    filing_type: str
    parse_status: FinancialMetricStatus
    source: FinancialMetricSource = "edgar"  # NEW — default preserves all existing EDGAR metrics

class FinancialsResult(BaseModel):
    ticker: str
    quarter: str
    filing_type: str
    status: FinancialsResultStatus
    metrics: list[FinancialMetric]
    filing_url: str
```

### yfinance API (v0.2.x)

```python
import yfinance as yf

# Create ticker object — SYNC, must run in executor
ticker_obj = yf.Ticker("TSLA")

# Quarterly income statement — SYNC, returns pd.DataFrame
# Columns are pd.Timestamp (quarter end dates), rows are metric names
df = ticker_obj.quarterly_income_stmt
```

**Key row labels in `quarterly_income_stmt`:**
| Our metric_name | DataFrame row label |
|-----------------|---------------------|
| `revenue`       | `"Total Revenue"` |
| `eps_basic`     | `"Basic EPS"` |
| `eps_diluted`   | `"Diluted EPS"` |
| `operating_income` | `"Operating Income"` |
| `gross_profit`  | `"Gross Profit"` |
| `net_income`    | `"Net Income"` |

**Note:** `gross_margin` is not available directly from yfinance income statement — skip it in yfinance supplement (it remains derived from EDGAR data only in `financials_service.py`).

### Quarter-to-Column Matching in yfinance DataFrame

yfinance DataFrame columns are `pd.Timestamp` objects representing the period end date. Match them to our quarter string using a 45-day tolerance (same as `financials_service.py`):

```python
import datetime
import pandas as pd

def _find_matching_column(df: pd.DataFrame, quarter: str) -> pd.Timestamp | None:
    target = _quarter_to_period_end_date(quarter)  # returns datetime.date
    best_col = None
    best_delta = datetime.timedelta(days=46)  # > 45 threshold
    for col in df.columns:
        delta = abs((col.date() - target))
        if delta < best_delta:
            best_delta = delta
            best_col = col
    return best_col if best_delta.days <= 45 else None
```

### Async Executor Pattern for yfinance

yfinance is fully synchronous. In an `asyncio` context (FastAPI), use executor to avoid blocking:

```python
import asyncio
import functools

async def supplement_with_yfinance(ticker: str, quarter: str, metrics_needed: list[str]) -> list[FinancialMetric]:
    loop = asyncio.get_event_loop()
    try:
        # All sync calls in one executor block to minimize thread overhead
        def _sync_fetch():
            import yfinance as yf
            ticker_obj = yf.Ticker(ticker)
            df = ticker_obj.quarterly_income_stmt
            return _extract_yfinance_metrics(ticker, quarter, df, metrics_needed)

        results = await loop.run_in_executor(None, _sync_fetch)
        ...
    except Exception as exc:
        logger.error("yfinance supplement failed", extra={...})
        return []
```

**Do NOT** import `yfinance` at module top-level — import inside the executor function to avoid import-time side effects in the test environment.

### Integration Point in `financials_service.py`

Add after the guidance extraction call and before the `result_status` calculation:

```python
# Identify metrics needing supplement
expected_metrics = set(XBRL_METRIC_CONCEPTS.keys())  # revenue, eps_basic, eps_diluted, etc.
edgar_success = {m.metric_name for m in metrics if m.parse_status == "SUCCESS"}
ambiguous = {m.metric_name for m in metrics if m.parse_status == "AMBIGUOUS"}
missing = expected_metrics - {m.metric_name for m in metrics}
supplement_targets = list(ambiguous | missing)

if supplement_targets:
    yf_metrics = await supplement_with_yfinance(ticker, quarter, supplement_targets)
    # Only add yfinance metric if name is not already SUCCESS from EDGAR
    for yf_metric in yf_metrics:
        if yf_metric.metric_name not in edgar_success:
            metrics.append(yf_metric)
```

### Structured Log Fields (AC2)

Every call to `supplement_with_yfinance` must produce exactly one log entry (either success or failure) with ALL of these fields:

```python
{
    "ticker": "TSLA",
    "quarter": "Q3-2024",
    "metrics_requested": ["revenue", "net_income"],   # list[str]
    "metrics_returned": ["revenue"],                   # list[str] — empty [] on failure
    "source": "yfinance",
    "timestamp": "...",   # ISO 8601 string via self.formatTime(record) in _ServiceJsonFormatter
}
```

Use `logger.info(...)` for success, `logger.error(...)` for failure. The `timestamp` field is automatically added by `_ServiceJsonFormatter` — do NOT add it manually to `extra`.

### Import Pattern for `yfinance_service.py`

```python
# src/services/yfinance_service.py
import asyncio
import datetime
from typing import TYPE_CHECKING

from src.core.logging import get_logger
from src.models.financials_models import FinancialMetric

logger = get_logger("ml-sidecar.yfinance_service")

# yfinance imported INSIDE executor function — see Task 3
```

### Test Mock Pattern

yfinance calls run inside `run_in_executor`. Mock the entire `_sync_fetch` inner function by patching `run_in_executor` or patching `yfinance.Ticker`:

```python
# tests/test_yfinance_service.py
import asyncio
import datetime
import logging
import pytest
import pandas as pd
from unittest.mock import MagicMock, patch, AsyncMock

from src.services.yfinance_service import supplement_with_yfinance, _extract_yfinance_metrics, _quarter_to_period_end_date

MOCK_DF = pd.DataFrame(
    {
        pd.Timestamp("2024-09-30"): {"Total Revenue": 25_000_000_000.0, "Net Income": 2_000_000_000.0, "Gross Profit": 8_000_000_000.0},
    }
)

@pytest.mark.asyncio
async def test_supplement_returns_yfinance_tagged_metrics():
    with patch("src.services.yfinance_service.asyncio.get_event_loop") as mock_loop:
        future = asyncio.get_event_loop().run_in_executor(None, lambda: None)
        # Simulate executor returning pre-built metrics
        mock_loop.return_value.run_in_executor = AsyncMock(return_value=[...])
        ...
```

**Simpler mock approach** — patch `yfinance.Ticker` inside the executor:

```python
@pytest.mark.asyncio
async def test_supplement_returns_yfinance_tagged_metrics():
    with patch("yfinance.Ticker") as mock_ticker_cls:
        mock_ticker = MagicMock()
        mock_ticker.quarterly_income_stmt = MOCK_DF
        mock_ticker_cls.return_value = mock_ticker
        results = await supplement_with_yfinance("TSLA", "Q3-2024", ["revenue", "net_income"])
    assert all(m.source == "yfinance" for m in results)
    assert all(m.parse_status == "SUCCESS" for m in results)
```

**Important:** Because `yfinance` is imported inside the executor function, patch `yfinance.Ticker` at the `yfinance` module level (not `src.services.yfinance_service.yf.Ticker`).

### Key Invariants

- `source: "yfinance"` must appear on every metric returned by `supplement_with_yfinance` — never `"edgar"`.
- `filing_url` is empty string `""` for yfinance metrics (no EDGAR URL).
- `filing_type` is `"yfinance"` for yfinance metrics (distinguishes from `"10-Q"` / `"10-K"`).
- `supplement_with_yfinance` never raises — every exception path returns `[]`.
- Exactly one log entry per `supplement_with_yfinance` call (success or failure).
- `ingest_financial_actuals` never fails due to yfinance errors — yfinance is additive only.

### Does Not Touch

- `src/main.py` — no new HTTP route
- `src/routers/analysis_router.py` — no change
- `src/core/edgar_client.py` — not used in yfinance service
- `src/core/temporal_aligner.py` — not in scope
- `src/services/ingestion_service.py` — do NOT modify
- `src/db/pool.py`, `src/db/queries.py` — no DB writes
- `ml-sidecar/tests/test_ingestion.py` — do NOT modify
- `ml-sidecar/tests/test_temporal_aligner.py` — do NOT modify
- `ml-sidecar/tests/test_financials.py` — do NOT modify (but must still pass)

### Pre-existing Test Count

As of story 3.4, the test suite has 91 tests. Run `pytest` after implementing; all pre-existing tests must pass (0 regressions). The `source` field addition to `FinancialMetric` uses a default value — existing `FinancialMetric(...)` constructor calls in test fixtures do NOT need to be updated.

### Project Structure Notes

- `yfinance_service.py` belongs in `src/services/` (domain logic layer), not `src/core/` (which is for infrastructure: edgar_client, logging, llm)
- Architecture says `yfinance — supplementary financial data, Phase 1 only (ingestion_service.py)` — this refers to the broader ingestion pipeline, not the file name. The correct file is `yfinance_service.py` as a new service, called from `financials_service.py`.
- All service files use snake_case. New service file: `yfinance_service.py`.
- The `logging.py` `_ServiceJsonFormatter` automatically adds `timestamp` — do NOT pass `timestamp` in the `extra` dict (it would create a duplicate key).

### References

- [Source: epics.md — Story 3.5: acceptance criteria, FR6, NFR19]
- [Source: architecture.md — Integration Points: "yfinance — supplementary financial data, Phase 1 only (ingestion_service.py)"]
- [Source: architecture.md — FastAPI project structure: `src/services/`]
- [Source: implementation-artifacts/3-3-10-q-10-k-financial-actuals-ingestion-and-parsing.md — `FinancialMetric` model, XBRL_METRIC_CONCEPTS map, `_quarter_to_period_end` logic, structured logging pattern]
- [Source: implementation-artifacts/3-4-temporal-alignment-engine.md — structured log pattern, executor async pattern, `_log_decision` exactly-once pattern]
- [Source: ml-sidecar/src/models/financials_models.py — current model definition (no `source` field yet)]
- [Source: ml-sidecar/src/services/financials_service.py — XBRL_METRIC_CONCEPTS, `ingest_financial_actuals` integration point]
- [Source: ml-sidecar/src/core/logging.py — `_ServiceJsonFormatter` adds `timestamp` automatically]

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List
