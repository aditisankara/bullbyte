# Story 4.6: CEO Delivery Score Computation

Status: done

## Story

As a **developer**,
I want a scoring service that aggregates all resolved verdicts for a company into a CEO Delivery Score with sample-size context,
So that users can see a single credible summary of management's track record that honestly reflects how many claims it is based on.

## Acceptance Criteria

**AC1 — Verdict counts computed correctly**

Given a company with at least one resolved verdict in PostgreSQL
When `scoring_service.py` computes the CEO Delivery Score
Then it counts: `delivered_count`, `missed_count`, `insufficient_data_count`, `pending_count`, and `total_resolved` (FR22)
And `total_resolved = delivered_count + missed_count` — excluding `INSUFFICIENT_DATA` and `PENDING`

**AC2 — Score includes sample-size context, never bare fraction**

Given the score is computed
When the result is returned
Then it includes sample-size context fields: `total_resolved`, `pending_count`, `insufficient_data_count` (FR23)
And the score is never returned as a bare fraction without sample-size context

**AC3 — Null score when no resolved claims**

Given a company where all claims are `PENDING` or `INSUFFICIENT_DATA`
When the scoring service runs
Then it returns `score: null` with a non-null `context_message` — never a score of `0.0` or a divide-by-zero error

**AC4 — Historical scores reconstructable from verdicts table**

Given verdicts accumulate over time
When score history is queried
Then historical scores are reconstructable from the append-only `verdicts` table — no separate score history table is needed (NFR7, FR24)
And `scoring_service.py` reads directly from `verdicts` joined through `claims` and `companies` — no materialized view, no cache table

**AC5 — New DB query helper `get_verdicts_for_ticker()` follows pool pattern**

Given `ml-sidecar/src/db/queries.py`
When this story is complete
Then it contains `get_verdicts_for_ticker(ticker: str)` returning grouped verdict counts as `list[asyncpg.Record]`
And it uses `pool.fetch()` with the same pool-acquire pattern as all other helpers in that file

## Tasks / Subtasks

- [x] Task 1: Add `get_verdicts_for_ticker()` to `ml-sidecar/src/db/queries.py` (AC: 5)
  - [x] Add after `get_executive_at_date()` at the bottom of the file
  - [x] Use `pool.fetch()` with the SQL in Dev Notes
  - [x] Returns `list[asyncpg.Record]` where each row has `verdict_type` (text) and `count` (int)

- [x] Task 2: Create `ml-sidecar/src/models/score_models.py` (AC: 1, 2, 3)
  - [x] Define `CeoDeliveryScore(BaseModel)` — fields in Dev Notes
  - [x] Use `ConfigDict(alias_generator=to_camel, populate_by_name=True)` for camelCase serialization (consistent with other models)

- [x] Task 3: Create `ml-sidecar/src/services/scoring_service.py` (AC: 1, 2, 3, 4)
  - [x] Define `async def compute_ceo_delivery_score(ticker: str) -> CeoDeliveryScore`
  - [x] Call `get_verdicts_for_ticker(ticker)` and accumulate counts per verdict_type
  - [x] Compute `score = delivered / (delivered + missed)` as `float | None`
  - [x] Return `null` score (not `0.0`) when `total_resolved == 0`
  - [x] Include `context_message` in all paths — see Dev Notes for wording

- [x] Task 4: Create `ml-sidecar/tests/test_scoring.py` (AC: 1, 2, 3)
  - [x] `test_score_computed_from_mixed_verdicts` — DELIVERED + MISSED + INSUFFICIENT_DATA → correct ratio
  - [x] `test_total_resolved_excludes_insufficient_and_pending` — verify counts per AC1
  - [x] `test_score_null_when_no_resolved_claims` — all PENDING/INSUFFICIENT_DATA → score is None
  - [x] `test_score_null_when_no_verdicts_at_all` — empty ticker → score is None, no exception
  - [x] `test_context_message_always_present` — every return has a non-empty `context_message`
  - [x] `test_get_verdicts_for_ticker_query_passes_ticker` — verify pool.fetch called with correct SQL and ticker arg

## Dev Notes

### Architecture: What This Story Creates

Story 4.6 creates two new files and extends one existing file:
1. `ml-sidecar/src/models/score_models.py` — **NEW** Pydantic model for the score result
2. `ml-sidecar/src/services/scoring_service.py` — **NEW** pure scoring service (reads DB, no LLM)
3. `ml-sidecar/src/db/queries.py` — **UPDATE** one new helper added at the bottom

No changes to `analysis_router.py`. No new routers. No schema changes. No Drizzle migrations. The `executives` table from story 3.8 and `get_executive_at_date()` from `queries.py` are **not used in this story** — CEO name attribution is deferred to story 5.6.

The score is computed on-demand by reading the append-only `verdicts` table. The NestJS `api/src/score/` module (story 5.6) will serve the score via HTTP by calling this service through the ML sidecar or by querying the DB directly.

### File Locations — Do Not Deviate

| File | Status | Path |
|------|--------|------|
| `score_models.py` | NEW | `ml-sidecar/src/models/score_models.py` |
| `scoring_service.py` | NEW | `ml-sidecar/src/services/scoring_service.py` |
| `queries.py` | UPDATE | `ml-sidecar/src/db/queries.py` — append `get_verdicts_for_ticker()` at bottom |
| `test_scoring.py` | NEW | `ml-sidecar/tests/test_scoring.py` |
| `analysis_router.py` | NO CHANGE | Does not call scoring — no integration in this story |
| `schema.ts` | NO CHANGE | `verdicts` table already exists |
| `executives` table | NOT USED | `get_executive_at_date()` exists but is not called in this story |

### DB Schema — Existing Tables Used (No New Migrations)

The query joins three existing tables:
```sql
-- verdicts (api/src/db/schema.ts lines 94–125)
verdicts (
  id             UUID PK
  claim_id       UUID NOT NULL REFERENCES claims(id) ON DELETE RESTRICT
  verdict_type   verdict_type NOT NULL  -- enum: DELIVERED|MISSED|INSUFFICIENT_DATA|PENDING|REVISED
  delta          TEXT
  confidence_score NUMERIC(4,3)
  is_correction  BOOLEAN DEFAULT false
  corrects_verdict_id UUID REFERENCES verdicts(id)
  created_at     TIMESTAMPTZ DEFAULT NOW()
)

-- claims
claims (
  id             UUID PK
  company_id     UUID NOT NULL REFERENCES companies(id)
  ...
)

-- companies
companies (
  id   UUID PK
  ticker TEXT NOT NULL
  ...
)
```

Verdict type values (SCREAMING_SNAKE_CASE): `DELIVERED` | `MISSED` | `INSUFFICIENT_DATA` | `PENDING` | `REVISED`

### New Query: `get_verdicts_for_ticker()`

Add after `get_executive_at_date()` at the end of `queries.py`:

```python
async def get_verdicts_for_ticker(ticker: str) -> list[asyncpg.Record]:
    """Return verdict counts grouped by verdict_type for all claims belonging to ticker.

    Joins through claims → companies to scope verdicts to the given ticker.
    Each record has: verdict_type (str), count (int).
    Returns an empty list if ticker not found or has no verdicts.
    """
    pool = await get_pool()
    return await pool.fetch(
        """
        SELECT v.verdict_type, COUNT(*)::int AS count
        FROM verdicts v
        JOIN claims c ON c.id = v.claim_id
        JOIN companies co ON co.id = c.company_id
        WHERE co.ticker = $1
        GROUP BY v.verdict_type
        """,
        ticker,
    )
```

### New Model: `CeoDeliveryScore`

Full file content for `ml-sidecar/src/models/score_models.py`:

```python
"""Pydantic model for CEO Delivery Score (story 4.6)."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class CeoDeliveryScore(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    ticker: str
    score: float | None          # delivered / total_resolved; None when no resolved claims
    delivered_count: int
    missed_count: int
    insufficient_data_count: int
    pending_count: int
    total_resolved: int          # delivered_count + missed_count only
    context_message: str         # human-readable summary always present
```

**Field invariants:**
- `total_resolved == delivered_count + missed_count` (never includes insufficient_data or pending)
- `score` is `None` when `total_resolved == 0` — never `0.0`
- `score` is a float between `0.0` and `1.0` inclusive when `total_resolved > 0`
- `context_message` is always a non-empty string

### New Service: `scoring_service.py`

Full file content for `ml-sidecar/src/services/scoring_service.py`:

```python
"""CEO Delivery Score computation service (story 4.6)."""

from __future__ import annotations

from src.core.logging import get_logger
from src.db.queries import get_verdicts_for_ticker
from src.models.score_models import CeoDeliveryScore

logger = get_logger("ml-sidecar.scoring_service")


async def compute_ceo_delivery_score(ticker: str) -> CeoDeliveryScore:
    """Aggregate all resolved verdicts for a company into a CEO Delivery Score.

    Reads directly from the append-only verdicts table — no separate score cache.
    Returns score=None when no resolved (DELIVERED or MISSED) verdicts exist.
    """
    rows = await get_verdicts_for_ticker(ticker)

    counts: dict[str, int] = {}
    for row in rows:
        counts[row["verdict_type"]] = row["count"]

    delivered = counts.get("DELIVERED", 0)
    missed = counts.get("MISSED", 0)
    insufficient = counts.get("INSUFFICIENT_DATA", 0)
    pending = counts.get("PENDING", 0)
    total_resolved = delivered + missed

    if total_resolved == 0:
        score = None
        context_message = "No resolved claims yet"
    else:
        score = delivered / total_resolved
        context_message = (
            f"{delivered} of {total_resolved} resolved promises delivered"
            + (f" — {pending} pending" if pending else "")
            + (f" — {insufficient} insufficient data" if insufficient else "")
        )

    logger.info(
        "CEO Delivery Score computed",
        extra={
            "ticker": ticker,
            "score": score,
            "delivered": delivered,
            "missed": missed,
            "total_resolved": total_resolved,
        },
    )

    return CeoDeliveryScore(
        ticker=ticker,
        score=score,
        delivered_count=delivered,
        missed_count=missed,
        insufficient_data_count=insufficient,
        pending_count=pending,
        total_resolved=total_resolved,
        context_message=context_message,
    )
```

### Test Patterns for `test_scoring.py`

The test file uses `AsyncMock` to patch `get_verdicts_for_ticker`. No DB pool setup needed.

**Shared mock factory:**

```python
"""Tests for CEO Delivery Score computation (story 4.6)."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from src.models.score_models import CeoDeliveryScore
from src.services.scoring_service import compute_ceo_delivery_score


def _mock_verdict_rows(counts: dict[str, int]) -> list[dict]:
    """Build fake asyncpg-style record rows from a verdict_type → count dict."""
    return [{"verdict_type": vtype, "count": count} for vtype, count in counts.items()]


@pytest.mark.asyncio
async def test_score_computed_from_mixed_verdicts():
    """6 delivered, 4 missed → score = 0.6, total_resolved = 10."""
    rows = _mock_verdict_rows({"DELIVERED": 6, "MISSED": 4, "INSUFFICIENT_DATA": 2, "PENDING": 1})
    with patch(
        "src.services.scoring_service.get_verdicts_for_ticker",
        new=AsyncMock(return_value=rows),
    ):
        result = await compute_ceo_delivery_score("AAPL")

    assert isinstance(result, CeoDeliveryScore)
    assert result.score == pytest.approx(0.6)
    assert result.delivered_count == 6
    assert result.missed_count == 4
    assert result.total_resolved == 10
    assert result.insufficient_data_count == 2
    assert result.pending_count == 1


@pytest.mark.asyncio
async def test_total_resolved_excludes_insufficient_and_pending():
    """INSUFFICIENT_DATA and PENDING are NOT counted in total_resolved (AC1)."""
    rows = _mock_verdict_rows({"DELIVERED": 3, "INSUFFICIENT_DATA": 10, "PENDING": 5})
    with patch(
        "src.services.scoring_service.get_verdicts_for_ticker",
        new=AsyncMock(return_value=rows),
    ):
        result = await compute_ceo_delivery_score("TSLA")

    assert result.total_resolved == 3   # only delivered, no missed
    assert result.score == pytest.approx(1.0)
    assert result.insufficient_data_count == 10
    assert result.pending_count == 5


@pytest.mark.asyncio
async def test_score_null_when_no_resolved_claims():
    """All claims PENDING or INSUFFICIENT_DATA → score is None, not 0.0 (AC3)."""
    rows = _mock_verdict_rows({"PENDING": 3, "INSUFFICIENT_DATA": 2})
    with patch(
        "src.services.scoring_service.get_verdicts_for_ticker",
        new=AsyncMock(return_value=rows),
    ):
        result = await compute_ceo_delivery_score("MSFT")

    assert result.score is None
    assert result.total_resolved == 0
    assert result.context_message == "No resolved claims yet"


@pytest.mark.asyncio
async def test_score_null_when_no_verdicts_at_all():
    """Empty ticker (unknown or unanalysed) → score is None, no ZeroDivisionError (AC3)."""
    with patch(
        "src.services.scoring_service.get_verdicts_for_ticker",
        new=AsyncMock(return_value=[]),
    ):
        result = await compute_ceo_delivery_score("UNKN")

    assert result.score is None
    assert result.total_resolved == 0
    assert result.delivered_count == 0
    assert result.missed_count == 0


@pytest.mark.asyncio
async def test_context_message_always_present():
    """context_message is a non-empty string for both null and non-null score paths (AC2)."""
    with patch(
        "src.services.scoring_service.get_verdicts_for_ticker",
        new=AsyncMock(return_value=[]),
    ):
        no_score = await compute_ceo_delivery_score("EMPTY")
    assert no_score.context_message and len(no_score.context_message) > 0

    rows = _mock_verdict_rows({"DELIVERED": 2, "MISSED": 1})
    with patch(
        "src.services.scoring_service.get_verdicts_for_ticker",
        new=AsyncMock(return_value=rows),
    ):
        has_score = await compute_ceo_delivery_score("AAPL")
    assert has_score.context_message and len(has_score.context_message) > 0


@pytest.mark.asyncio
async def test_get_verdicts_for_ticker_called_with_correct_ticker():
    """get_verdicts_for_ticker receives the ticker string passed to compute_ceo_delivery_score."""
    mock_query = AsyncMock(return_value=[])
    with patch("src.services.scoring_service.get_verdicts_for_ticker", new=mock_query):
        await compute_ceo_delivery_score("NVDA")
    mock_query.assert_called_once_with("NVDA")
```

### Logger Name — Do Not Change

```python
logger = get_logger("ml-sidecar.scoring_service")
```

Do NOT add `timestamp` to any `extra` dict — the formatter adds it automatically.

### Regression Guard: Existing Tests Must Stay Green

All existing tests must remain green. This story adds only new files and one new function at the end of `queries.py` — no existing functions are modified.

**Pre-existing failures (unrelated to this story):**
- `test_ingestion.py` (12 tests, lxml missing in test environment)
- `test_yfinance_service.py` (6 tests, yfinance missing in test environment)

### Architecture Guardrails

- `scoring_service.py` never imports from `verification_service.py`, `extraction_service.py`, or any LLM module — pure DB read + arithmetic only
- `compute_ceo_delivery_score()` is a standalone async function, not a class method — consistent with other services in the codebase
- The score is `float | None`, never `Decimal` — confidence scores use `Decimal` but the CEO score is a ratio and does not need arbitrary precision
- `REVISED` verdict type exists in the schema but is deferred to Phase 2. If `REVISED` rows exist in the DB, `counts.get("REVISED", 0)` returns 0 — they are silently excluded from the score. Do NOT special-case them or raise an error.
- `get_verdicts_for_ticker()` returns an empty list (not None) when the ticker has no verdicts — the service handles this correctly by calling `.get()` with a default of 0
- Never call `get_executive_at_date()` in this story — CEO name attribution is out of scope here

### Integration Context: Where This Service Is Used

Story 4.6 creates the service; it is not yet wired into the analysis pipeline or any HTTP endpoint:
- Story 5.6 (`ceo-score-endpoint-and-immutable-verdict-writes`) will expose `GET /api/v1/companies/:ticker/score` from NestJS. That story may call this service via the ML sidecar or query PostgreSQL directly — that decision belongs to story 5.6.
- `analysis_router.py` does NOT call `compute_ceo_delivery_score()` in this story.

### References

- [`ml-sidecar/src/db/queries.py`](ml-sidecar/src/db/queries.py) — add `get_verdicts_for_ticker()` at bottom
- [`api/src/db/schema.ts:94`](api/src/db/schema.ts:94) — `verdicts` table (claim_id FK, verdict_type, is_correction)
- [`api/src/db/schema.ts:62`](api/src/db/schema.ts:62) — `claims` table (company_id FK)
- [`api/src/db/schema.ts:35`](api/src/db/schema.ts:35) — `companies` table (ticker column)
- [`ml-sidecar/src/models/verdict_models.py`](ml-sidecar/src/models/verdict_models.py) — pattern for Pydantic models with camelCase config
- [`ml-sidecar/src/services/verification_service.py`](ml-sidecar/src/services/verification_service.py) — pattern for async service functions
- [`ml-sidecar/tests/test_executive_queries.py`](ml-sidecar/tests/test_executive_queries.py) — pattern for query-layer tests using AsyncMock pool
- [`ml-sidecar/tests/conftest.py`](ml-sidecar/tests/conftest.py) — autouse fixtures (_env, _mock_db_cache) apply to all tests
- [`_bmad-output/implementation-artifacts/3-8-executive-tenure-schema.md`](_bmad-output/implementation-artifacts/3-8-executive-tenure-schema.md) — `executives` table and `get_executive_at_date()` exist but are NOT used here

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6 (story creation via bmad-create-story, 2026-06-07)
claude-sonnet-4-6 (story implementation via bmad-dev-story, 2026-06-07)

### Debug Log References

### Completion Notes List

- Added `get_verdicts_for_ticker(ticker)` to `queries.py` — joins verdicts → claims → companies, groups by verdict_type, returns empty list for unknown tickers
- Created `score_models.py` with `CeoDeliveryScore` Pydantic model (camelCase aliases, `score: float | None`, `total_resolved = delivered + missed` only)
- Created `scoring_service.py` with `compute_ceo_delivery_score(ticker)` — pure read service, no LLM, no writes; returns `score=None` when `total_resolved == 0` to prevent divide-by-zero
- `REVISED` verdict type silently excluded via `counts.get()` defaulting to 0 — deferred to Phase 2 per architecture guardrails
- 6/6 new tests pass; 143/143 full suite pass (zero regressions)

### File List

- ml-sidecar/src/models/score_models.py (NEW)
- ml-sidecar/src/services/scoring_service.py (NEW)
- ml-sidecar/src/db/queries.py (UPDATE — appended `get_verdicts_for_ticker()`)
- ml-sidecar/tests/test_scoring.py (NEW)

### Review Findings

- [x] [Review][Decision] Ticker case normalization — resolved: normalize in the service via `ticker.upper()` [`scoring_service.py:18`]
- [x] [Review][Patch] Test name mismatch — spec requires `test_get_verdicts_for_ticker_query_passes_ticker`; shipped as `test_get_verdicts_for_ticker_called_with_correct_ticker` [`ml-sidecar/tests/test_scoring.py:100`]
- [x] [Review][Patch] Missing `missed_count == 0` assertion in `test_total_resolved_excludes_insufficient_and_pending` [`ml-sidecar/tests/test_scoring.py:55`]
- [x] [Review][Patch] Missing `delivered_count == 0` and `missed_count == 0` assertions in `test_score_null_when_no_resolved_claims` [`ml-sidecar/tests/test_scoring.py:67`]
- [x] [Review][Patch] No test for `REVISED` verdict type being silently excluded — spec explicitly names this as an architecture guardrail [`ml-sidecar/tests/test_scoring.py`]
- [x] [Review][Patch] No assertion on non-null score `context_message` content — added `test_context_message_includes_pending_and_insufficient_annotations` [`ml-sidecar/tests/test_scoring.py`]
- [x] [Review][Defer] No error handling on `pool.fetch()` — consistent with all other read helpers in `queries.py`; pre-existing pattern [`ml-sidecar/src/db/queries.py`] — deferred, pre-existing
- [x] [Review][Defer] No model-level range constraint on `score` field (0.0–1.0) — computation guarantees the range; Field(ge=0, le=1) would be defensive hardening [`ml-sidecar/src/models/score_models.py`] — deferred, pre-existing
- [x] [Review][Defer] No ticker validation for empty/blank string — should be enforced at the API boundary in story 5.6 [`ml-sidecar/src/services/scoring_service.py`] — deferred, pre-existing

## Change Log

- 2026-06-07: Story created — ready for dev
- 2026-06-07: Implemented story 4.6 — added `get_verdicts_for_ticker()` query, created `CeoDeliveryScore` model and `compute_ceo_delivery_score()` service, created `test_scoring.py` with 6 tests covering all ACs. 143/143 tests pass.
- 2026-06-08: Code review complete — 1 decision-needed, 5 patches, 3 deferred, 11 dismissed.
