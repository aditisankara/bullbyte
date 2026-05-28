# Story 3.4: Temporal Alignment Engine

Status: done

## Story

As a **developer**,
I want a temporal alignment engine that maps each earnings call to its correct subsequent reporting quarter's actuals,
So that claims made in one quarter are always verified against the correct actuals filing — never misaligned.

## Acceptance Criteria

1. **Given** an earnings call transcript for a specific quarter
   **When** `temporal_aligner.py` maps it to its verification quarter
   **Then** it identifies the correct subsequent 10-Q/10-K filing covering the period the claims refer to (FR3)
   **And** the mapping decision is logged as a structured record: `{ ticker, call_quarter, actuals_quarter, filing_type, filing_url, alignment_confidence, mapping_rationale }` (FR4, NFR8)

2. **Given** a mapping where the correct actuals quarter is ambiguous (e.g. fiscal vs calendar year mismatch)
   **When** the aligner cannot determine the mapping with high confidence
   **Then** it records `alignment_confidence: "LOW"` with a human-readable `mapping_rationale` explaining the ambiguity
   **And** it does not silently produce a high-confidence mapping — uncertain alignments are explicitly flagged (NFR8)

3. **Given** a quarter where no subsequent actuals filing exists yet
   **When** the aligner processes that quarter
   **Then** it marks the alignment status as `PENDING` and logs the reason: actuals quarter not yet filed

4. **Given** the alignment log for any ticker
   **When** a developer inspects it
   **Then** every quarter-to-filing mapping decision is present as a structured record — no silent mappings or gaps (NFR8)

## Tasks / Subtasks

- [x] Task 1: Create `src/models/alignment_models.py` (AC: 1, 2, 3, 4)
  - [x] Define `AlignmentConfidence = Literal["HIGH", "MEDIUM", "LOW"]`
  - [x] Define `AlignmentStatus = Literal["ALIGNED", "PENDING", "AMBIGUOUS", "FETCH_ERROR"]`
  - [x] Define `AlignmentDecision` Pydantic model with fields: `ticker: str`, `call_quarter: str`, `actuals_quarter: str`, `filing_type: str`, `filing_url: str`, `alignment_confidence: AlignmentConfidence`, `mapping_rationale: str`, `status: AlignmentStatus`

- [x] Task 2: Implement quarter arithmetic helpers in `src/core/temporal_aligner.py` (AC: 1, 2, 3)
  - [x] `_next_quarter(quarter: str) -> str` — pure function: Q1-Y→Q2-Y, Q2-Y→Q3-Y, Q3-Y→Q4-Y, Q4-Y→Q1-(Y+1)
  - [x] `_quarter_to_period_end(quarter: str) -> str` — pure function: Q1→03-31, Q2→06-30, Q3→09-30, Q4→12-31 (returns "YYYY-MM-DD")
  - [x] `_quarter_to_filing_type(quarter: str) -> str` — pure function: Q4→"10-K", Q1/Q2/Q3→"10-Q"
  - [x] Each function validates input format; raises `ValueError` with structured message on bad input (e.g. `"Q5-2024"`, `"bad"`)

- [x] Task 3: Implement EDGAR filing lookup — `_find_filing_url(ticker, cik, quarter, filing_type)` (AC: 1, 3)
  - [x] Fetch `https://data.sec.gov/submissions/CIK{cik}.json` via `get_client().fetch(url, ticker=ticker, filing_type="submissions")`
  - [x] Call `response.json()` inside try/except `json.JSONDecodeError`; re-raise as `EdgarFetchError` if parse fails
  - [x] Calculate `period_end = _quarter_to_period_end(quarter)`, `cutoff = period_end + 180 days`
  - [x] Zip `accessionNumber`, `filingDate`, `form` from `filings.recent`; filter: `form == filing_type` AND `period_end_dt <= filing_dt <= cutoff_dt`
  - [x] Also handle large-filer pagination: fetch each entry in `filings.files` via `https://data.sec.gov/submissions/{name}`; page JSON also wrapped in try/except `json.JSONDecodeError`
  - [x] Among all matches, return the one with earliest `filingDate` — derive URL: `https://www.sec.gov/Archives/edgar/data/{cik_int}/{acc_path}/{acc_no}-index.htm` where `cik_int = str(int(cik))`, `acc_path = acc_no.replace("-", "")`
  - [x] Return `str | None` — `None` means no matching filing found (PENDING case)
  - [x] All EDGAR HTTP calls via `get_client()` — no direct `httpx` calls

- [x] Task 4: Implement decision logger — `_log_decision(decision: AlignmentDecision) -> None` (AC: 4, NFR8)
  - [x] Emit `logger.info("temporal alignment decision", extra={...})` with all 8 fields from `AlignmentDecision` as `extra` keys
  - [x] Every call to `align_call_to_actuals` must call `_log_decision` — no alignment exits without a log entry

- [x] Task 5: Implement main entry point — `align_call_to_actuals(ticker, call_quarter) -> AlignmentDecision` (AC: 1–4)
  - [x] `actuals_quarter = _next_quarter(call_quarter)`; `filing_type = _quarter_to_filing_type(actuals_quarter)`
  - [x] Resolve CIK: `cik = await resolve_cik(ticker)` (imported from `src.services.ingestion_service`); catch `ValueError` → return `AlignmentDecision(status="FETCH_ERROR", alignment_confidence="LOW", mapping_rationale=f"Unknown ticker: {ticker}", filing_url="", ...)`
  - [x] Find primary filing: `filing_url = await _find_filing_url(ticker, cik, actuals_quarter, filing_type)` inside `try/except EdgarFetchError`; on error → return `AlignmentDecision(status="FETCH_ERROR", alignment_confidence="LOW", ...)`
  - [x] **If primary filing found:** return `AlignmentDecision(status="ALIGNED", alignment_confidence="HIGH", mapping_rationale=f"Calendar quarter succession: {call_quarter} → {actuals_quarter}; {filing_type} confirmed", filing_url=filing_url, ...)`
  - [x] **If primary filing NOT found:** try alternate quarter — `alt_quarter = _next_quarter(actuals_quarter)`; `alt_filing_type = _quarter_to_filing_type(alt_quarter)`; attempt `_find_filing_url(ticker, cik, alt_quarter, alt_filing_type)`
    - If alternate filing found → return `AlignmentDecision(status="ALIGNED", alignment_confidence="LOW", actuals_quarter=alt_quarter, filing_type=alt_filing_type, mapping_rationale=f"Primary quarter {actuals_quarter} not found; aligned to {alt_quarter} — possible fiscal year offset", filing_url=alt_url, ...)` (AC2)
    - If alternate also not found → return `AlignmentDecision(status="PENDING", alignment_confidence="LOW", actuals_quarter=actuals_quarter, filing_url="", mapping_rationale=f"No {filing_type} found for {actuals_quarter} or {alt_quarter} — filing may not yet be available", ...)`
  - [x] Always call `_log_decision(decision)` before returning — no early returns without logging (AC4, NFR8)

- [x] Task 6: Write tests `tests/test_temporal_aligner.py` (AC: 1–4)
  - [x] Test: `_next_quarter("Q1-2024")` → `"Q2-2024"`, `_next_quarter("Q4-2024")` → `"Q1-2025"` (parameterized all 4 transitions)
  - [x] Test: `_quarter_to_period_end("Q1-2024")` → `"2024-03-31"`, all 4 quarters (parameterized)
  - [x] Test: `_quarter_to_filing_type("Q4-2024")` → `"10-K"`, `_quarter_to_filing_type("Q3-2024")` → `"10-Q"`
  - [x] Test: `align_call_to_actuals("TSLA", "Q3-2024")` returns `AlignmentDecision` with `status="ALIGNED"`, `alignment_confidence="HIGH"`, `actuals_quarter="Q4-2024"`, non-empty `filing_url` (mock `_find_filing_url` to return a URL)
  - [x] Test: `align_call_to_actuals` returns `status="PENDING"` when primary and alternate filings both return `None` (mock both `_find_filing_url` calls returning `None`)
  - [x] Test: `align_call_to_actuals` returns `status="ALIGNED"` with `alignment_confidence="LOW"` when primary returns `None` but alternate filing found (AC2 fiscal year offset case)
  - [x] Test: `align_call_to_actuals` returns `status="FETCH_ERROR"` when `_find_filing_url` raises `EdgarFetchError`
  - [x] Test: `align_call_to_actuals` returns `status="FETCH_ERROR"` when `resolve_cik` raises `ValueError` (unknown ticker)
  - [x] Test: every call to `align_call_to_actuals` produces exactly one structured log entry containing all required fields (`ticker`, `call_quarter`, `actuals_quarter`, `filing_type`, `filing_url`, `alignment_confidence`, `mapping_rationale`, `status`) — verify via `caplog` fixture (NFR8, AC4)
  - [x] Test: `_next_quarter` raises `ValueError` on bad input (e.g. `"bad"`, `"Q5-2024"`)

## Dev Notes

### What This Story Builds

Two new files:
- `ml-sidecar/src/core/temporal_aligner.py` — the alignment engine (NEW)
- `ml-sidecar/src/models/alignment_models.py` — Pydantic models for alignment decisions (NEW)

No modifications to any existing file. No DB writes — story 3.6 handles persistence.

### Hard Scope Boundaries

- **No PostgreSQL writes** — return `AlignmentDecision` in-memory. DB persistence is story 3.6. Do NOT touch `src/db/pool.py` or `src/db/queries.py`.
- **No modifications to `ingestion_service.py` or `financials_service.py`** — import from them, do not change them.
- **No new dependencies** — all needed packages (`httpx`, `pydantic`, `tenacity`) are already in `pyproject.toml`. Do NOT run `uv add`.
- **All EDGAR HTTP calls via `get_client()`** — never use `httpx.AsyncClient` directly in `temporal_aligner.py`.

### File Locations (Architecture-Mandated)

```
ml-sidecar/
  src/
    core/
      temporal_aligner.py     ← NEW (this story)
      edgar_client.py         ← EXISTING — import get_client(), EdgarFetchError only; do NOT modify
      edgar_models.py         ← EXISTING — import EdgarFetchError only; do NOT modify
      logging.py              ← EXISTING — import get_logger() from here
    models/
      alignment_models.py     ← NEW (this story)
      financials_models.py    ← EXISTING — do NOT modify
      ingestion_models.py     ← EXISTING — do NOT modify
    services/
      ingestion_service.py    ← EXISTING — import resolve_cik() only; do NOT modify
  tests/
    test_temporal_aligner.py  ← NEW (this story; flat in tests/)
```

### Pydantic Models for `alignment_models.py`

```python
from typing import Literal
from pydantic import BaseModel

AlignmentConfidence = Literal["HIGH", "MEDIUM", "LOW"]
AlignmentStatus = Literal["ALIGNED", "PENDING", "AMBIGUOUS", "FETCH_ERROR"]

class AlignmentDecision(BaseModel):
    ticker: str
    call_quarter: str        # e.g. "Q3-2024" — the earnings call quarter
    actuals_quarter: str     # e.g. "Q4-2024" — quarter whose filing verifies the claims
    filing_type: str         # "10-Q" or "10-K"
    filing_url: str          # EDGAR filing index URL; empty string ("") when status != "ALIGNED"
    alignment_confidence: AlignmentConfidence  # "HIGH" | "MEDIUM" | "LOW"
    mapping_rationale: str   # human-readable explanation of the mapping decision
    status: AlignmentStatus  # "ALIGNED" | "PENDING" | "AMBIGUOUS" | "FETCH_ERROR"
```

**`AlignmentStatus` semantics:**
- `ALIGNED` — filing confirmed in EDGAR; actuals_quarter and filing_url are definitive
- `PENDING` — filing not yet available; claim verdicts should remain `PENDING`
- `AMBIGUOUS` — reserved for future use when multiple filings match
- `FETCH_ERROR` — EDGAR fetch failed or ticker not found; alignment cannot be completed

**`AlignmentConfidence` semantics:**
- `HIGH` — straightforward calendar quarter succession, filing confirmed at `_next_quarter(call_quarter)`
- `MEDIUM` — reserved for future fiscal year detection; not emitted in this story's implementation
- `LOW` — alignment uncertain: either EDGAR fetch failed, filing not found at primary quarter (fell back to alternate), or unknown ticker

### Quarter Arithmetic

```python
def _next_quarter(quarter: str) -> str:
    """Advance quarter by one. Raises ValueError on bad input."""
    try:
        parts = quarter.split("-")
        if len(parts) != 2 or not parts[0].upper().startswith("Q"):
            raise ValueError
        q_num = int(parts[0][1])  # 1–4
        year = int(parts[1])
        if q_num not in (1, 2, 3, 4):
            raise ValueError
    except (IndexError, ValueError):
        raise ValueError(f"Invalid quarter format: {quarter!r}. Expected 'Q{{n}}-{{YYYY}}'")
    if q_num == 4:
        return f"Q1-{year + 1}"
    return f"Q{q_num + 1}-{year}"
```

```python
def _quarter_to_period_end(quarter: str) -> str:
    """Map 'Q3-2024' → '2024-09-30'. Same ±45-day tolerance logic as financials_service."""
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
```

```python
def _quarter_to_filing_type(quarter: str) -> str:
    """Return '10-K' for Q4, '10-Q' otherwise. Same logic as financials_service."""
    return "10-K" if quarter.upper().startswith("Q4") else "10-Q"
```

**Important:** `_quarter_to_period_end` and `_quarter_to_filing_type` are duplicated from `financials_service.py` — the private implementations there cannot be imported. This is intentional; `temporal_aligner.py` is a `core/` module (not `services/`) and must be independently deployable.

### EDGAR Submissions JSON Structure (for `_find_filing_url`)

```python
# GET https://data.sec.gov/submissions/CIK0001318605.json
{
  "filings": {
    "recent": {
      "accessionNumber": ["0001318605-25-000001", ...],
      "filingDate":      ["2025-01-15", ...],
      "form":            ["10-K", ...]
    },
    "files": [
      {"name": "CIK0001318605-submissions-001.json", ...}
    ]
  }
}
```

Filing URL derivation (same pattern as `financials_service.py`):
```python
cik_int = str(int(cik))          # "0001318605" → "1318605"
acc_path = acc_no.replace("-", "")  # "0001318605-24-000086" → "000131860524000086"
url = f"https://www.sec.gov/Archives/edgar/data/{cik_int}/{acc_path}/{acc_no}-index.htm"
```

Date filter (same 180-day window as `financials_service.py`):
```python
from datetime import datetime, timedelta

period_end_dt = datetime.strptime(_quarter_to_period_end(quarter), "%Y-%m-%d")
cutoff_dt = period_end_dt + timedelta(days=180)

# Keep entries where: form == filing_type AND period_end_dt <= filing_dt <= cutoff_dt
# Return earliest matching filing (most closely follows the period end)
```

**JSONDecodeError handling** — `response.json()` and page `json()` calls must be wrapped in `try/except json.JSONDecodeError`; re-raise as `EdgarFetchError` to give callers a consistent error contract:
```python
import json
try:
    payload = response.json()
except json.JSONDecodeError as exc:
    raise EdgarFetchError(ticker=ticker, filing_type="submissions", url=url, final_status=response.status_code) from exc
```

### Import Pattern

```python
# src/core/temporal_aligner.py — top-level imports
import json
from datetime import datetime, timedelta

from src.core.edgar_client import EdgarFetchError, get_client
from src.core.logging import get_logger
from src.models.alignment_models import AlignmentConfidence, AlignmentDecision, AlignmentStatus
from src.services.ingestion_service import resolve_cik

logger = get_logger("ml-sidecar.temporal_aligner")
```

`resolve_cik` was made public in story 3.3 (renamed from `_resolve_cik`). It is safe to import. The shared `_TICKER_CIK_MAP` cache in `ingestion_service.py` means CIK is only fetched once across all services.

### Structured Logging Pattern

Follow `financials_service.py` exactly:

```python
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
```

Every exit path in `align_call_to_actuals` must call `_log_decision` before returning. This satisfies NFR8 ("every temporal alignment decision is logged — no silent mapping failures").

### Test Mock Pattern

Follow `test_financials.py` exactly — use `unittest.mock.patch` to mock `get_client` and `resolve_cik`:

```python
# tests/test_temporal_aligner.py
import json
import pytest
import logging
from unittest.mock import AsyncMock, MagicMock, patch
import httpx
import src.services.ingestion_service as ingestion_svc
from src.core.temporal_aligner import (
    _next_quarter, _quarter_to_period_end, _quarter_to_filing_type, align_call_to_actuals
)
from src.models.alignment_models import AlignmentDecision

@pytest.fixture(autouse=True)
def reset_cik_cache():
    ingestion_svc._TICKER_CIK_MAP = {}
    yield
    ingestion_svc._TICKER_CIK_MAP = {}

@pytest.fixture
def mock_client():
    with patch("src.core.temporal_aligner.get_client") as mock_factory:
        client = MagicMock()
        client.fetch = AsyncMock()
        mock_factory.return_value = client
        yield client

@pytest.fixture
def mock_resolve_cik():
    with patch("src.core.temporal_aligner.resolve_cik", new_callable=AsyncMock) as mock_fn:
        mock_fn.return_value = "0001318605"
        yield mock_fn
```

For the structured log assertion (AC4, NFR8), use `caplog`:
```python
@pytest.mark.asyncio
async def test_every_decision_is_logged(mock_client, mock_resolve_cik, caplog):
    # setup mock_client.fetch to return a mock submissions response
    ...
    with caplog.at_level(logging.INFO, logger="ml-sidecar.temporal_aligner"):
        decision = await align_call_to_actuals("TSLA", "Q3-2024")
    assert len(caplog.records) >= 1
    record = caplog.records[-1]
    # All 8 required fields must appear in extra
    for field in ("ticker", "call_quarter", "actuals_quarter", "filing_type",
                  "filing_url", "alignment_confidence", "mapping_rationale", "status"):
        assert hasattr(record, field) or field in str(record.__dict__), f"Missing field: {field}"
```

**Minimum mock submissions JSON for filing found:**
```python
MOCK_SUBMISSIONS_FILING_FOUND = {
    "filings": {
        "recent": {
            "accessionNumber": ["0001318605-25-000001"],
            "filingDate": ["2025-01-15"],
            "form": ["10-K"]
        },
        "files": []
    }
}
mock_client.fetch.return_value = httpx.Response(200, json=MOCK_SUBMISSIONS_FILING_FOUND)
```

**For PENDING case** (no matching filing):
```python
MOCK_SUBMISSIONS_NO_MATCH = {
    "filings": {
        "recent": {"accessionNumber": [], "filingDate": [], "form": []},
        "files": []
    }
}
# Return this for BOTH mock_client.fetch calls (primary and alternate quarter)
mock_client.fetch.return_value = httpx.Response(200, json=MOCK_SUBMISSIONS_NO_MATCH)
```

Note: when testing the alternate-quarter fallback path, `mock_client.fetch` will be called **twice** (once for primary quarter lookup, once for alternate). Use `AsyncMock(side_effect=[...])` to return different responses per call.

### Key Invariants

- Quarter format `"Q{n}-{YYYY}"` — canonical enum. Never `"2024Q3"`, `"Q3 2024"`.
- `filing_url` is an empty string `""` when `status != "ALIGNED"` — never `None` (Pydantic model is `str`, not `str | None`).
- `align_call_to_actuals` never raises — every error path returns an `AlignmentDecision` with appropriate status.
- Every call to `align_call_to_actuals` produces exactly one `_log_decision` call (NFR8).
- The alternate-quarter fallback always attempts `_next_quarter(actuals_quarter)` — never more than 2 quarters ahead. This covers the fiscal year offset case (AC2) without unbounded lookahead.

### Does Not Touch

- `src/main.py` — `temporal_aligner` is a library, no new HTTP route registered
- `src/routers/analysis_router.py` — stub unchanged
- `src/services/ingestion_service.py` — import `resolve_cik` only; do NOT modify
- `src/services/financials_service.py` — do NOT import from or modify
- `src/db/pool.py`, `src/db/queries.py` — no DB writes in this story
- `src/core/edgar_client.py` — import only; do NOT modify
- `ml-sidecar/tests/test_ingestion.py` — do NOT modify; all pre-existing tests must still pass
- `ml-sidecar/tests/test_financials.py` — do NOT modify; all pre-existing tests must still pass

### Pre-existing Test Count

As of story 3.3, the test suite has 40 tests (18 in `test_financials.py` + 22 in `test_ingestion.py` + others). Run `pytest` after implementing this story; all pre-existing tests must pass (0 regressions).

### References

- [Source: epics.md — Story 3.4: acceptance criteria, FR3, FR4, NFR8]
- [Source: architecture.md — FastAPI Project Structure: `src/core/temporal_aligner.py`, `src/models/`]
- [Source: architecture.md — Canonical Enums: Quarter format "Q{n}-{YYYY}", Structured Logging fields]
- [Source: implementation-artifacts/3-3-10-q-10-k-financial-actuals-ingestion-and-parsing.md — `_quarter_to_period_end`, `_quarter_to_filing_type`, `_find_filing_accession` logic, JSONDecodeError handling (P3, P9), mock_client fixture, resolve_cik import pattern, 180-day filing window, large-filer pagination, `cik_int`/`acc_path` derivation]
- [Source: implementation-artifacts/3-2-8-k-earnings-call-transcript-ingestion-and-parsing.md — `resolve_cik` public API, `_TICKER_CIK_MAP` cache reset in tests]

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

- Implemented `src/models/alignment_models.py` with `AlignmentConfidence`, `AlignmentStatus` type aliases and `AlignmentDecision` Pydantic model.
- Implemented `src/core/temporal_aligner.py` with quarter arithmetic helpers, EDGAR filing lookup (with large-filer pagination and JSONDecodeError handling), decision logger, and main `align_call_to_actuals` entry point.
- All error paths (unknown ticker, EDGAR fetch error, no filing found) return an `AlignmentDecision` — never raises.
- Every exit path calls `_log_decision` exactly once (NFR8 satisfied).
- Alternate-quarter fallback covers fiscal year offset case (AC2).
- Wrote 22 tests in `tests/test_temporal_aligner.py` covering all ACs; 91/91 total tests pass (0 regressions).

### File List

- ml-sidecar/src/models/alignment_models.py (new)
- ml-sidecar/src/core/temporal_aligner.py (new)
- ml-sidecar/tests/test_temporal_aligner.py (new)

## Senior Developer Review (AI)

**Date:** 2026-05-27
**Outcome:** Changes Requested
**Layers:** Blind Hunter + Edge Case Hunter + Acceptance Auditor

### Review Findings

#### Patch Items
- [x] [Review][Patch] `align_call_to_actuals` calls `_next_quarter(call_quarter)` uncaught — violates "never raises" contract; bad `call_quarter` propagates `ValueError` to caller [temporal_aligner.py:112]
- [x] [Review][Patch] Alt-quarter `EdgarFetchError` silently swallowed as `alt_url = None` — should return `FETCH_ERROR` decision, not fall through to `PENDING` [temporal_aligner.py:~155]
- [x] [Review][Patch] Pagination fallback `page_payload.get("recent", page_payload)` passes entire dict when key missing — should be `page_payload.get("recent", {})` [temporal_aligner.py:~93]
- [x] [Review][Patch] `_next_quarter` parses only `parts[0][1]` so `"Q10-2024"` is silently accepted as Q1 instead of raising `ValueError` [temporal_aligner.py:~29]
- [x] [Review][Patch] `_quarter_to_filing_type` lacks input validation — spec Task 2 requires each helper to validate [temporal_aligner.py:~58]
- [x] [Review][Patch] `test_every_decision_is_logged` asserts `>= 1` record — weakens NFR8 "exactly one log per call" guarantee; change to `== 1` [test_temporal_aligner.py]
- [x] [Review][Patch] `test_aligned_low_alternate_quarter` missing assertion on `decision.actuals_quarter` field — regression in returned quarter string would go undetected [test_temporal_aligner.py]
- [x] [Review][Patch] Missing test: alt-quarter `EdgarFetchError` → `FETCH_ERROR` decision (needed once patch #2 is applied) [test_temporal_aligner.py]

#### Deferred Items
- [x] [Review][Defer] `acc_no.replace("-", "")` has no format validation [temporal_aligner.py] — deferred, pre-existing pattern in financials_service.py; scope creep for 3.4
- [x] [Review][Defer] `str(int(cik))` will raise uncaught `ValueError` if non-numeric CIK passed [temporal_aligner.py] — deferred, internal function; `resolve_cik` guarantees numeric string
- [x] [Review][Defer] Filing date window lower bound excludes pre-period-end filings [temporal_aligner.py] — deferred, calendar-quarter design is intentional; fiscal year offset handled by alt-quarter path
- [x] [Review][Defer] Earliest filing selected over later amendments [temporal_aligner.py] — deferred, pre-existing pattern in financials_service.py; correctness trade-off for future story
- [x] [Review][Defer] `_quarter_to_period_end` inconsistently lacks `len(parts) != 2` guard vs `_next_quarter` [temporal_aligner.py] — deferred, `IndexError` is caught and re-raised as `ValueError`; works correctly
- [x] [Review][Defer] `PENDING` status assigned `LOW` confidence — spec doesn't define confidence for PENDING [temporal_aligner.py] — deferred, LOW is most reasonable default; AC3 constraint only requires PENDING status

### Action Items

| # | Severity | Title | Status |
|---|----------|-------|--------|
| 1 | High | `_next_quarter` uncaught in `align_call_to_actuals` | [ ] |
| 2 | High | Alt-quarter EdgarFetchError silently swallowed | [ ] |
| 3 | High | Pagination fallback passes entire payload dict | [ ] |
| 4 | Med | `_next_quarter` accepts "Q10-2024" as Q1 | [ ] |
| 5 | Med | `_quarter_to_filing_type` lacks input validation | [ ] |
| 6 | Med | Log test asserts >= 1 instead of == 1 | [ ] |
| 7 | Low | Alt-quarter test missing actuals_quarter assertion | [ ] |
| 8 | Low | Missing test for alt EdgarFetchError → FETCH_ERROR | [ ] |

### Review Follow-ups (AI)

- [x] [AI-Review][High] Fix `_next_quarter` uncaught call in `align_call_to_actuals`
- [x] [AI-Review][High] Fix alt-quarter `EdgarFetchError` → return `FETCH_ERROR` decision
- [x] [AI-Review][High] Fix pagination fallback: `page_payload.get("recent", {})` not `page_payload`
- [x] [AI-Review][Med] Fix `_next_quarter` prefix validation to catch "Q10-2024"
- [x] [AI-Review][Med] Add input validation to `_quarter_to_filing_type`
- [x] [AI-Review][Med] Change log test assertion from `>= 1` to `== 1`
- [x] [AI-Review][Low] Add `actuals_quarter` assertion to alt-quarter test
- [x] [AI-Review][Low] Add test for alt EdgarFetchError → FETCH_ERROR

## Change Log

- 2026-05-27: Story 3.4 implemented — temporal alignment engine with EDGAR lookup, structured logging, and full test coverage (22 tests added).
- 2026-05-27: Code review complete — 8 patch items, 6 deferred. Status set to in-progress for follow-up.
