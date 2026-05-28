# Story 3.6: PostgreSQL Caching & Re-ingestion Prevention

Status: review

## Story

As a **developer**,
I want the ingestion service to check PostgreSQL before fetching from EDGAR and persist all results after fetching,
So that repeat requests for the same ticker and quarter return cached data instantly without redundant EDGAR calls.

## Acceptance Criteria

1. **Given** a ticker and quarter that have already been ingested
   **When** the ingestion service is triggered again for that combination
   **Then** it detects the existing record in PostgreSQL and returns cached data without any EDGAR requests (FR5)
   **And** a log entry notes `cache_hit: true` with the ticker and quarter

2. **Given** a ticker and quarter with no cached data
   **When** the ingestion service runs
   **Then** it fetches from EDGAR, parses results, and persists them to PostgreSQL before returning
   **And** a log entry notes `cache_hit: false` with the ticker, quarter, and fetch duration in ms

3. **Given** a successful ingestion run
   **When** results are written to PostgreSQL via asyncpg
   **Then** all writes complete atomically — no partial ingestion records are left in the DB on failure

4. **Given** concurrent ingestion requests for the same ticker and quarter
   **When** both requests check the cache simultaneously
   **Then** only one EDGAR fetch occurs — the second request reuses the first result (NFR11)
   **And** no duplicate records are created in PostgreSQL

## Tasks / Subtasks

- [x] Task 1: Add `transcripts` and `financialActuals` tables to `api/src/db/schema.ts` (AC: 1, 2, 3, 4)
  - [x] Add `unique` to the `drizzle-orm/pg-core` named imports
  - [x] Add `transcripts` table (see Dev Notes for exact definition)
  - [x] Add `financialActuals` table (see Dev Notes for exact definition)
  - [x] Export `Transcript`, `NewTranscript`, `FinancialActuals`, `NewFinancialActuals` TypeScript types via `$inferSelect` / `$inferInsert`
  - [x] Do NOT modify any existing table definitions — append only

- [x] Task 2: Generate and commit the Drizzle migration (AC: 3)
  - [x] From the `api/` directory, run `npx drizzle-kit generate`
  - [x] Confirm a new `0001_*.sql` file is generated in `api/src/db/migrations/`
  - [x] Review the SQL: verify it contains `CREATE TABLE "transcripts"`, `CREATE TABLE "financial_actuals"`, and both unique constraints
  - [x] Commit the generated SQL file as-is — do NOT edit it manually or squash it into `0000_certain_warbird.sql`

- [x] Task 3: Add asyncpg cache helpers to `ml-sidecar/src/db/queries.py` (AC: 1, 2, 3)
  - [x] Add `get_cached_transcript(ticker, quarter) -> asyncpg.Record | None` — SELECT by (ticker, quarter) from `transcripts`
  - [x] Add `insert_transcript(*, ticker, quarter, filing_date, raw_text, filing_url, parse_status) -> None` — INSERT with `ON CONFLICT (ticker, quarter) DO NOTHING`
  - [x] Add `get_cached_financial_actuals(ticker, quarter) -> asyncpg.Record | None` — SELECT by (ticker, quarter) from `financial_actuals`
  - [x] Add `insert_financial_actuals(*, ticker, quarter, filing_type, status, filing_url, metrics_json: str) -> None` — INSERT with `ON CONFLICT (ticker, quarter) DO NOTHING`; pass `metrics_json` as `$N::jsonb`
  - [x] Follow the exact same structural pattern as existing helpers in `queries.py`: `pool = await get_pool()`, then `pool.fetchrow(...)` or `pool.execute(...)`
  - [x] Do NOT modify any existing helper functions

- [x] Task 4: Add cache check and persist in `ml-sidecar/src/services/ingestion_service.py` (AC: 1, 2, 4)
  - [x] Import `get_cached_transcript`, `insert_transcript` from `src.db.queries`
  - [x] Add module-level lock registry for concurrency safety (see Dev Notes — `_TRANSCRIPT_CACHE_LOCKS` dict + meta lock)
  - [x] In `ingest_8k_transcripts`, immediately after `quarter = _filing_date_to_quarter(filing_date)` (inside the `for filing in filings:` loop), acquire the per-quarter asyncio lock and add cache-check logic (see Dev Notes for exact snippet)
  - [x] If cache hit: reconstruct `TranscriptResult`, append to `results`, increment `transcripts_extracted`, log `cache_hit: true`, then `continue`
  - [x] After the existing `results.append(TranscriptResult(...))` call: if `best_status == "SUCCESS"`, call `await insert_transcript(...)` — persist only SUCCESS transcripts
  - [x] Add `cache_hit: false` structured log after completing a fresh EDGAR fetch, with `fetch_duration_ms` field

- [x] Task 5: Add cache check and persist in `ml-sidecar/src/services/financials_service.py` (AC: 1, 2, 4)
  - [x] Import `get_cached_financial_actuals`, `insert_financial_actuals` from `src.db.queries`
  - [x] Import `asyncio` (already imported? verify), `json`, `time`
  - [x] Add module-level lock registry for concurrency safety (see Dev Notes — `_FINANCIALS_CACHE_LOCKS` dict + meta lock)
  - [x] At the very top of `ingest_financial_actuals` (before any EDGAR calls): record `start_time = time.monotonic()`, then acquire per-quarter lock and check `get_cached_financial_actuals(ticker, quarter)` (see Dev Notes)
  - [x] If cache hit: log `cache_hit: true`, reconstruct `FinancialsResult` from cache row (deserialise `metrics` JSONB → `list[FinancialMetric]`), return immediately — no EDGAR calls
  - [x] After computing `result_status` and constructing the final `FinancialsResult`: if `result.status in ("SUCCESS", "PARTIAL")`, call `await insert_financial_actuals(...)` with `metrics_json = json.dumps([m.model_dump() for m in result.metrics])`
  - [x] Log `cache_hit: false` with `fetch_duration_ms = int((time.monotonic() - start_time) * 1000)` after the EDGAR fetch path completes
  - [x] Do NOT change the function signature of `ingest_financial_actuals`

- [x] Task 6: Write tests `tests/test_caching.py` (AC: 1, 2, 3, 4)
  - [x] Test: transcript cache hit — mock `get_cached_transcript` to return a mock Record; verify `get_client().fetch` is NOT called at all; verify returned `IngestionSummary` has the expected `TranscriptResult`
  - [x] Test: transcript cache miss — mock `get_cached_transcript` to return `None`; verify `get_client().fetch` IS called; verify `insert_transcript` is called with correct ticker/quarter/parse_status
  - [x] Test: financials cache hit — mock `get_cached_financial_actuals` to return a mock Record with pre-built JSON metrics; verify `ingest_financial_actuals` returns `FinancialsResult` with correct metrics; verify no EDGAR calls made
  - [x] Test: financials cache miss — mock `get_cached_financial_actuals` to return `None`; complete existing EDGAR mock chain; verify `insert_financial_actuals` is called with `status="SUCCESS"` or `"PARTIAL"`
  - [x] Test: `cache_hit: true` log emitted on cache hit for both transcript and financials paths (use `caplog`)
  - [x] Test: `cache_hit: false` log with `fetch_duration_ms` emitted on cache miss for both paths
  - [x] Test: non-cacheable status not persisted — mock a `FinancialsResult` with `status="FETCH_ERROR"`; verify `insert_financial_actuals` is NOT called
  - [x] Test: non-SUCCESS transcript not persisted — set `best_status="PARSE_FAILURE"`; verify `insert_transcript` is NOT called

- [x] Task 7: Verify pre-existing tests still pass
  - [x] Run `pytest` from `ml-sidecar/` — all 114 pre-existing tests must pass, 0 regressions
  - [x] New imports in services must not break any existing test that mocks at the service level

## Dev Notes

### What This Story Builds

Six file changes:

| File | Change |
|------|--------|
| `api/src/db/schema.ts` | UPDATE: add `transcripts` and `financialActuals` table definitions |
| `api/src/db/migrations/0001_*.sql` | NEW: generated by `drizzle-kit generate` — do NOT hand-write |
| `ml-sidecar/src/db/queries.py` | UPDATE: add 4 cache helpers (`get_cached_transcript`, `insert_transcript`, `get_cached_financial_actuals`, `insert_financial_actuals`) |
| `ml-sidecar/src/services/ingestion_service.py` | UPDATE: cache-check per quarter in filing loop + persist on SUCCESS |
| `ml-sidecar/src/services/financials_service.py` | UPDATE: cache-check at top + persist on SUCCESS/PARTIAL |
| `ml-sidecar/tests/test_caching.py` | NEW: 8+ tests for cache hit/miss paths |

### Hard Scope Boundaries

- **Schema authority is `api/src/db/schema.ts`** — FastAPI never defines or alters schema. Never write SQL migration files by hand.
- **Only SUCCESS transcripts are cached** — `PARSE_FAILURE`, `FETCH_ERROR`, `NO_TRANSCRIPT` results are NOT persisted to the `transcripts` table.
- **Only SUCCESS + PARTIAL financials are cached** — `FETCH_ERROR` and `FILING_NOT_YET_AVAILABLE` results are NOT persisted to `financial_actuals`.
- **`ON CONFLICT (ticker, quarter) DO NOTHING`** — the unique constraint is the DB-level safety net for any concurrent writes that slip past the asyncio lock.
- **No changes to `IngestionSummary` or `FinancialsResult` models** — the public API of both services stays identical; caching is transparent.
- **No changes to `temporal_aligner.py`** — not in scope.
- **No changes to `src/main.py` or any router** — no new HTTP endpoints.
- **Do not add `insert_transcript` / `insert_financial_actuals` calls anywhere other than the services described in Tasks 4 and 5.**

### Task 1: Drizzle Schema Additions (`api/src/db/schema.ts`)

Add `unique` to the import (line 1):
```typescript
import {
    AnyPgColumn,
    check,
    index,
    unique,          // ← ADD THIS
    numeric,
    integer,
    boolean,
    jsonb,
    pgEnum,
    pgTable,
    text,
    timestamp,
    uuid,
} from 'drizzle-orm/pg-core';
```

Append after the `toolCallLogs` block at the end of the file:

```typescript
export const transcripts = pgTable(
    'transcripts',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        ticker: text('ticker').notNull(),
        quarter: text('quarter').notNull(),     // "Q3-2024" format
        filingDate: text('filing_date').notNull(),
        rawText: text('raw_text').notNull(),
        filingUrl: text('filing_url').notNull(),
        parseStatus: text('parse_status').notNull(),  // always "SUCCESS" when cached
        ingestedAt: timestamp('ingested_at', { withTimezone: true })
            .defaultNow()
            .notNull(),
    },
    (t) => [
        unique('transcripts_ticker_quarter_unique').on(t.ticker, t.quarter),
        index('idx_transcripts_ticker').on(t.ticker),
    ]
);

export type Transcript = typeof transcripts.$inferSelect;
export type NewTranscript = typeof transcripts.$inferInsert;

export const financialActuals = pgTable(
    'financial_actuals',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        ticker: text('ticker').notNull(),
        quarter: text('quarter').notNull(),     // "Q3-2024" format
        filingType: text('filing_type').notNull(),  // "10-Q" or "10-K"
        status: text('status').notNull(),       // "SUCCESS" or "PARTIAL" when cached
        filingUrl: text('filing_url').notNull(),
        metrics: jsonb('metrics').notNull(),    // serialised list[FinancialMetric]
        ingestedAt: timestamp('ingested_at', { withTimezone: true })
            .defaultNow()
            .notNull(),
    },
    (t) => [
        unique('financial_actuals_ticker_quarter_unique').on(t.ticker, t.quarter),
        index('idx_financial_actuals_ticker').on(t.ticker),
    ]
);

export type FinancialActuals = typeof financialActuals.$inferSelect;
export type NewFinancialActuals = typeof financialActuals.$inferInsert;
```

### Task 2: Generating the Migration

```bash
# From api/ directory:
npx drizzle-kit generate
```

The generated SQL will look approximately like:

```sql
CREATE TABLE "transcripts" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "ticker" text NOT NULL,
    "quarter" text NOT NULL,
    "filing_date" text NOT NULL,
    "raw_text" text NOT NULL,
    "filing_url" text NOT NULL,
    "parse_status" text NOT NULL,
    "ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "transcripts_ticker_quarter_unique" UNIQUE("ticker","quarter")
);
--> statement-breakpoint
CREATE TABLE "financial_actuals" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "ticker" text NOT NULL,
    "quarter" text NOT NULL,
    "filing_type" text NOT NULL,
    "status" text NOT NULL,
    "filing_url" text NOT NULL,
    "metrics" jsonb NOT NULL,
    "ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "financial_actuals_ticker_quarter_unique" UNIQUE("ticker","quarter")
);
--> statement-breakpoint
CREATE INDEX "idx_transcripts_ticker" ON "transcripts" USING btree ("ticker");
--> statement-breakpoint
CREATE INDEX "idx_financial_actuals_ticker" ON "financial_actuals" USING btree ("ticker");
```

**Do not manually edit this file.** If the generated SQL doesn't look right, fix the schema definition and re-run `generate`.

### Task 3: asyncpg Helpers in `queries.py`

Add the following four helpers to `ml-sidecar/src/db/queries.py`. Follow the exact same structural patterns as the existing helpers (UUID generation from Python, pool-level execute/fetchrow):

```python
# ---------------------------------------------------------------------------
# transcripts (cache)
# ---------------------------------------------------------------------------

async def get_cached_transcript(ticker: str, quarter: str) -> asyncpg.Record | None:
    """Return cached transcript row for (ticker, quarter), or None if not cached."""
    pool = await get_pool()
    return await pool.fetchrow(
        """
        SELECT ticker, quarter, filing_date, raw_text, filing_url, parse_status
        FROM transcripts
        WHERE ticker = $1 AND quarter = $2
        """,
        ticker,
        quarter,
    )


async def insert_transcript(
    *,
    ticker: str,
    quarter: str,
    filing_date: str,
    raw_text: str,
    filing_url: str,
    parse_status: str,
) -> None:
    """Persist a transcript to the cache. ON CONFLICT (ticker, quarter) DO NOTHING."""
    pool = await get_pool()
    row_id = str(uuid.uuid4())
    await pool.execute(
        """
        INSERT INTO transcripts
            (id, ticker, quarter, filing_date, raw_text, filing_url, parse_status)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (ticker, quarter) DO NOTHING
        """,
        row_id,
        ticker,
        quarter,
        filing_date,
        raw_text,
        filing_url,
        parse_status,
    )


# ---------------------------------------------------------------------------
# financial_actuals (cache)
# ---------------------------------------------------------------------------

async def get_cached_financial_actuals(ticker: str, quarter: str) -> asyncpg.Record | None:
    """Return cached financial_actuals row for (ticker, quarter), or None if not cached."""
    pool = await get_pool()
    return await pool.fetchrow(
        """
        SELECT ticker, quarter, filing_type, status, filing_url, metrics
        FROM financial_actuals
        WHERE ticker = $1 AND quarter = $2
        """,
        ticker,
        quarter,
    )


async def insert_financial_actuals(
    *,
    ticker: str,
    quarter: str,
    filing_type: str,
    status: str,
    filing_url: str,
    metrics_json: str,
) -> None:
    """Persist financial actuals to the cache. ON CONFLICT (ticker, quarter) DO NOTHING.

    metrics_json must be a pre-serialised JSON string:
        json.dumps([m.model_dump() for m in result.metrics])
    asyncpg will cast it to JSONB via the $7::jsonb parameter binding.
    """
    pool = await get_pool()
    row_id = str(uuid.uuid4())
    await pool.execute(
        """
        INSERT INTO financial_actuals
            (id, ticker, quarter, filing_type, status, filing_url, metrics)
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
        ON CONFLICT (ticker, quarter) DO NOTHING
        """,
        row_id,
        ticker,
        quarter,
        filing_type,
        status,
        filing_url,
        metrics_json,
    )
```

**Note:** `asyncpg.Record` is a read-only dict-like object. Access fields by name: `row["ticker"]`, `row["metrics"]`. When asyncpg reads a `jsonb` column, it returns a Python list/dict already — no `json.loads()` needed on reads.

### Task 4: Cache Integration in `ingestion_service.py`

#### Imports to add at the top:
```python
import time
from src.db.queries import get_cached_transcript, insert_transcript
```

#### Module-level lock registry (add after the existing `_cik_map_lock` definition):
```python
# Per (ticker, quarter) asyncio locks — prevent duplicate EDGAR fetches under concurrency (NFR11)
_TRANSCRIPT_CACHE_LOCKS: dict[str, asyncio.Lock] = {}
_TRANSCRIPT_CACHE_LOCKS_META = asyncio.Lock()


async def _get_transcript_lock(ticker: str, quarter: str) -> asyncio.Lock:
    key = f"{ticker}:{quarter}"
    async with _TRANSCRIPT_CACHE_LOCKS_META:
        if key not in _TRANSCRIPT_CACHE_LOCKS:
            _TRANSCRIPT_CACHE_LOCKS[key] = asyncio.Lock()
        return _TRANSCRIPT_CACHE_LOCKS[key]
```

#### Changes to `ingest_8k_transcripts`:

Record start time at the top of the function (before the `for filing in filings:` loop):
```python
ingest_start = time.monotonic()
```

Inside the `for filing in filings:` loop, after `quarter = _filing_date_to_quarter(filing_date)` and before the existing `exhibits = await _get_exhibit_documents(...)` call, replace the existing block with the cache-check wrapper:

```python
        # ── Cache check ──────────────────────────────────────────────────────
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
                transcripts_extracted += 1
                continue

            # ── Cache miss: proceed with EDGAR fetch ─────────────────────────
            filing_fetch_start = time.monotonic()

            try:
                exhibits = await _get_exhibit_documents(cik, accession_no)
            except EdgarFetchError as exc:
                # ... existing error handling unchanged ...

            # ... existing exhibit-scoring logic unchanged ...

            results.append(TranscriptResult(
                ticker=ticker,
                quarter=quarter,
                filing_date=filing_date,
                raw_text=best_text or "",
                filing_url=best_url,
                parse_status=best_status,
            ))

            if best_status == "SUCCESS":
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
```

**Important:** The entire `try: exhibits = ...` block and the exhibit-scoring logic that follows must remain INSIDE `async with _lock:`. The `continue` statements in the exception handlers work correctly inside the lock context — they release the lock before proceeding to the next loop iteration.

### Task 5: Cache Integration in `financials_service.py`

#### Imports to add at the top:
```python
import json
import time
from src.db.queries import get_cached_financial_actuals, insert_financial_actuals
```

(Check if `json` is already imported — it is in the existing file. Don't duplicate it.)

#### Module-level lock registry (add after existing module-level logger):
```python
# Per (ticker, quarter) asyncio locks — prevent duplicate EDGAR fetches under concurrency (NFR11)
_FINANCIALS_CACHE_LOCKS: dict[str, asyncio.Lock] = {}
_FINANCIALS_CACHE_LOCKS_META = asyncio.Lock()


async def _get_financials_lock(ticker: str, quarter: str) -> asyncio.Lock:
    key = f"{ticker}:{quarter}"
    async with _FINANCIALS_CACHE_LOCKS_META:
        if key not in _FINANCIALS_CACHE_LOCKS:
            _FINANCIALS_CACHE_LOCKS[key] = asyncio.Lock()
        return _FINANCIALS_CACHE_LOCKS[key]
```

#### Changes to `ingest_financial_actuals`:

The function's logic needs to be wrapped with a cache-check, a per-ticker lock, and a persist-on-completion. The cleanest approach is:

1. Record `start_time = time.monotonic()` at the very top of the function.
2. Immediately after, do a **fast-path cache check** (no lock) — the common case for repeated lookups:

```python
async def ingest_financial_actuals(ticker: str, quarter: str) -> FinancialsResult:
    """..."""
    start_time = time.monotonic()

    # ── Fast-path cache check (no lock — optimistic) ─────────────────────────
    cached = await get_cached_financial_actuals(ticker, quarter)
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
        if cached:
            logger.info(
                "financial actuals cache hit (post-lock re-check)",
                extra={"ticker": ticker, "quarter": quarter, "cache_hit": True},
            )
            return _reconstruct_financials_result(cached)

        # ── EDGAR fetch (existing logic — unchanged) ─────────────────────────
        filing_type = _quarter_to_filing_type(quarter)
        # ... all existing try/except blocks and early-return paths ...

        # ── At the end, before returning the final result ─────────────────────
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
```

3. Add the `_reconstruct_financials_result` private helper above `ingest_financial_actuals`:

```python
def _reconstruct_financials_result(row: "asyncpg.Record") -> FinancialsResult:
    """Reconstruct a FinancialsResult from a cached financial_actuals DB row.

    asyncpg returns JSONB columns as native Python objects (list[dict]) —
    no json.loads() needed.
    """
    metrics_data: list[dict] = row["metrics"] or []
    metrics = [FinancialMetric(**m) for m in metrics_data]
    return FinancialsResult(
        ticker=row["ticker"],
        quarter=row["quarter"],
        filing_type=row["filing_type"],
        status=row["status"],
        metrics=metrics,
        filing_url=row["filing_url"],
    )
```

**Critical note on early-return paths:** The existing `ingest_financial_actuals` has several early returns for error conditions (`FETCH_ERROR`, `FILING_NOT_YET_AVAILABLE`). These paths do NOT persist to cache (only `SUCCESS`/`PARTIAL` results are cached). Make sure all existing early-return `FinancialsResult(...)` objects are returned as-is — the `insert_financial_actuals` call only happens on the success path at the very end.

The existing `filing_type = _quarter_to_filing_type(quarter)` line currently appears at the top of the function. After the refactor it will appear inside the `async with _lock:` block (after the re-check). This is intentional — it only runs on the slow EDGAR path.

### Concurrency Design (NFR11)

Two patterns work together:

| Layer | Mechanism | What it prevents |
|-------|-----------|-----------------|
| asyncio (in-process) | `asyncio.Lock` per (ticker, quarter) | Duplicate EDGAR fetches within the same process |
| PostgreSQL (cross-process) | `ON CONFLICT (ticker, quarter) DO NOTHING` | Duplicate DB rows from multi-process or re-entrant calls |

The double-checked locking pattern (fast-path check → acquire lock → re-check → fetch):
- **Fast-path (no lock):** avoids lock contention for the overwhelmingly common case (cache hit)
- **Slow-path re-check (inside lock):** handles the race where two coroutines both passed the fast-path check simultaneously — only one will win the lock, fetch EDGAR, and persist; the second will find the cache populated on re-check

This design satisfies AC4: only one EDGAR fetch per (ticker, quarter) at any point in time, within a single process.

### JSONB Deserialization

When asyncpg fetches a `jsonb` column, it returns the Python-native equivalent automatically — no `json.loads()` needed:
- `financial_actuals.metrics` comes back as `list[dict]` (Python list of dicts)
- Reconstruct `FinancialMetric` objects with: `[FinancialMetric(**m) for m in row["metrics"]]`

When inserting:
- You MUST pre-serialise to a JSON string and use the `::jsonb` cast in the SQL
- `json.dumps([m.model_dump() for m in result.metrics])` produces the correct string
- Do NOT pass a Python list directly to asyncpg for a `jsonb` column — pass the serialised string with `::jsonb` cast

### Structured Log Fields

**Cache hit log (both services):**
```python
logger.info(
    "transcript cache hit",        # or "financial actuals cache hit"
    extra={
        "ticker": ticker,
        "quarter": quarter,
        "cache_hit": True,
    },
)
```

**Cache miss log (both services, after EDGAR fetch completes):**
```python
logger.info(
    "transcript cache miss — EDGAR fetch complete",  # or "financial actuals cache miss..."
    extra={
        "ticker": ticker,
        "quarter": quarter,
        "cache_hit": False,
        "fetch_duration_ms": int((time.monotonic() - fetch_start) * 1000),
    },
)
```

The existing "8-K ingestion complete" / "financial actuals ingestion complete" log entries at the end of each function must remain unchanged — they fire on both cache-hit and cache-miss paths.

### Test Patterns for `tests/test_caching.py`

The cache helpers are async — mock them with `AsyncMock`:

```python
# tests/test_caching.py
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from src.services.ingestion_service import ingest_8k_transcripts

@pytest.mark.asyncio
async def test_transcript_cache_hit_skips_edgar():
    """If get_cached_transcript returns a row, no EDGAR client calls should occur."""
    mock_row = {
        "ticker": "TSLA",
        "quarter": "Q3-2024",
        "filing_date": "2024-10-23",
        "raw_text": "cached transcript text",
        "filing_url": "https://sec.gov/.../ex99.htm",
        "parse_status": "SUCCESS",
    }
    with patch("src.services.ingestion_service.get_cached_transcript", new_callable=AsyncMock) as mock_cache, \
         patch("src.services.ingestion_service.get_client") as mock_get_client:
        mock_cache.return_value = mock_row
        # Patch resolve_cik and _get_8k_filings to return one fake filing
        with patch("src.services.ingestion_service.resolve_cik", new_callable=AsyncMock, return_value="0001318605"), \
             patch("src.services.ingestion_service._get_8k_filings", new_callable=AsyncMock,
                   return_value=[{"accession_no": "0001318605-24-000123", "filing_date": "2024-10-23"}]):
            summary = await ingest_8k_transcripts("TSLA", "2024-10-01", "2024-10-31")

    # EDGAR client fetch must not be called for exhibit documents
    mock_get_client.return_value.fetch.assert_not_called()
    assert summary.transcripts_extracted == 1
    assert summary.results[0].raw_text == "cached transcript text"
```

For mocking the financials cache:
```python
@pytest.mark.asyncio
async def test_financials_cache_hit_skips_edgar():
    import json
    from src.models.financials_models import FinancialMetric
    mock_metrics = [
        FinancialMetric(ticker="TSLA", quarter="Q3-2024", metric_name="revenue",
                        value="25000000000.0", unit="USD", section_reference="us-gaap/Revenues",
                        filing_url="https://...", filing_type="10-Q",
                        parse_status="SUCCESS", source="edgar")
    ]
    mock_row = {
        "ticker": "TSLA",
        "quarter": "Q3-2024",
        "filing_type": "10-Q",
        "status": "SUCCESS",
        "filing_url": "https://...",
        "metrics": [m.model_dump() for m in mock_metrics],  # asyncpg returns already-parsed list
    }
    with patch("src.services.financials_service.get_cached_financial_actuals",
               new_callable=AsyncMock, return_value=mock_row):
        with patch("src.services.financials_service.get_client") as mock_client:
            result = await ingest_financial_actuals("TSLA", "Q3-2024")

    mock_client.return_value.fetch.assert_not_called()
    assert result.status == "SUCCESS"
    assert len(result.metrics) == 1
    assert result.metrics[0].metric_name == "revenue"
```

### Does Not Touch

- `src/main.py` — no new routes; lifespan handler may need `close_pool()` already there from story 1.3 setup, verify
- `src/routers/analysis_router.py` — no changes
- `src/core/edgar_client.py` — no changes
- `src/core/temporal_aligner.py` — not in scope for this story
- `src/models/ingestion_models.py` — `TranscriptResult` and `IngestionSummary` unchanged
- `src/models/financials_models.py` — `FinancialMetric` and `FinancialsResult` unchanged
- `ml-sidecar/tests/test_ingestion.py` — DO NOT modify
- `ml-sidecar/tests/test_financials.py` — DO NOT modify
- `ml-sidecar/tests/test_temporal_aligner.py` — DO NOT modify
- `ml-sidecar/tests/test_yfinance_service.py` — DO NOT modify
- `api/src/db/migrations/0000_certain_warbird.sql` — DO NOT touch existing migration

### Pre-existing Test Count

As of story 3.5, the test suite has **114 tests**. Run `pytest` after implementation; all 114 must pass before adding the new caching tests. New caching tests bring the total to ~122.

### References

- [Source: epics.md — Story 3.6: acceptance criteria, FR5, NFR11]
- [Source: api/src/db/schema.ts — existing table patterns (UUID PK, pgTable, index, check constraints)]
- [Source: api/src/db/migrations/0000_certain_warbird.sql — existing Drizzle migration output style]
- [Source: api/drizzle.config.ts — migration output directory: `./src/db/migrations`]
- [Source: ml-sidecar/src/db/pool.py — `get_pool()` returns asyncpg.Pool; double-checked locking pattern]
- [Source: ml-sidecar/src/db/queries.py — `insert_claim`, `insert_verdict` patterns (UUID from Python, pool.execute, typed kwargs)]
- [Source: ml-sidecar/src/services/ingestion_service.py — `ingest_8k_transcripts` loop structure; `TranscriptResult` construction points]
- [Source: ml-sidecar/src/services/financials_service.py — `ingest_financial_actuals` early-return paths; `_TICKER_CIK_MAP` module-level pattern for lock registry]
- [Source: ml-sidecar/src/models/ingestion_models.py — `TranscriptResult` fields for cache row mapping]
- [Source: ml-sidecar/src/models/financials_models.py — `FinancialMetric.model_dump()` for JSONB serialisation; `FinancialsResult` for reconstruction]

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

None — implementation went cleanly without debugging detours.

### Completion Notes List

- Added `unique` import and appended `transcripts` + `financialActuals` table definitions to `api/src/db/schema.ts`. All existing tables left untouched.
- Ran `npx drizzle-kit generate` from `api/`; generated `0001_wakeful_polaris.sql` containing both CREATE TABLE statements with UNIQUE constraints and btree indexes. SQL not hand-edited.
- Added four asyncpg helpers to `ml-sidecar/src/db/queries.py` following the existing UUID-from-Python + pool.execute/fetchrow pattern: `get_cached_transcript`, `insert_transcript` (ON CONFLICT DO NOTHING), `get_cached_financial_actuals`, `insert_financial_actuals` (metrics as `::jsonb`).
- Integrated cache-check in `ingest_8k_transcripts`: per-quarter asyncio lock acquired after computing `quarter`, fast-path cache hit returns immediately, cache miss wraps the entire EDGAR fetch inside the lock, inserts on SUCCESS only.
- Integrated cache-check in `ingest_financial_actuals`: double-checked locking pattern (fast-path no-lock check → acquire lock → re-check → EDGAR fetch). Added `_reconstruct_financials_result` helper. `_quarter_to_filing_type` call moved inside the lock (slow path only). Inserts on SUCCESS or PARTIAL. All early-return error paths bypass persist.
- Added `asyncpg` import to `financials_service.py` for the `asyncpg.Record` type annotation on `_reconstruct_financials_result`.
- Added `tests/test_caching.py` with 10 tests covering: transcript cache hit (EDGAR skipped, log emitted), transcript cache miss (insert called, log with fetch_duration_ms), PARSE_FAILURE not persisted, financials cache hit (EDGAR skipped, log emitted), financials cache miss (insert called, log with fetch_duration_ms), FETCH_ERROR not persisted.
- Added two autouse fixtures to `tests/conftest.py`: `_mock_db_cache` patches all four cache helpers to cache-miss/noop so existing unit tests need no DB; `_reset_lock_registries` clears per-(ticker,quarter) lock dicts and `_TICKER_CIK_MAP` between tests to prevent event-loop cross-contamination.
- Full test suite: 114 pre-existing (0 regressions) + 10 new = **124 passing**.

### File List

- `api/src/db/schema.ts` — updated: added `unique` import, `transcripts` and `financialActuals` table definitions + TypeScript types
- `api/src/db/migrations/0001_wakeful_polaris.sql` — new: generated Drizzle migration
- `ml-sidecar/src/db/queries.py` — updated: added `get_cached_transcript`, `insert_transcript`, `get_cached_financial_actuals`, `insert_financial_actuals`
- `ml-sidecar/src/services/ingestion_service.py` — updated: cache-check + persist in `ingest_8k_transcripts`; `_TRANSCRIPT_CACHE_LOCKS` lock registry
- `ml-sidecar/src/services/financials_service.py` — updated: cache-check + persist in `ingest_financial_actuals`; `_FINANCIALS_CACHE_LOCKS` lock registry; `_reconstruct_financials_result` helper; `asyncpg` import
- `ml-sidecar/tests/test_caching.py` — new: 10 caching tests
- `ml-sidecar/tests/conftest.py` — updated: `_mock_db_cache` and `_reset_lock_registries` autouse fixtures

## Change Log

- 2026-05-28: Story created by bmad-create-story.
- 2026-05-28: Story implemented by dev agent (claude-sonnet-4-6). All 7 tasks complete. 124/124 tests passing.
- 2026-05-28: Code review by bmad-code-review (claude-sonnet-4-6). 5 patches, 3 deferred, 8 dismissed.

### Review Findings

- [ ] [Review][Patch] `_reset_lock_registries` does not clear `_TRANSCRIPT_CACHE_LOCKS_META` / `_FINANCIALS_CACHE_LOCKS_META` — stale meta-locks survive across pytest function-scoped event loops [ml-sidecar/tests/conftest.py]
- [ ] [Review][Patch] `cache_hit: false` log only emitted on `best_status == "SUCCESS"` in `ingest_8k_transcripts` — AC2 requires the log on all cache-miss paths (PARSE_FAILURE, FETCH_ERROR, NO_TRANSCRIPT also hit EDGAR) [ml-sidecar/src/services/ingestion_service.py]
- [ ] [Review][Patch] Missing test: `FILING_NOT_YET_AVAILABLE` financials result must not be persisted — spec Task 6 lists this as a distinct required test case, only FETCH_ERROR is covered [ml-sidecar/tests/test_caching.py]
- [ ] [Review][Patch] Missing test: `NO_TRANSCRIPT` transcript result must not be persisted — spec Task 6 requires non-SUCCESS transcript tests beyond PARSE_FAILURE [ml-sidecar/tests/test_caching.py]
- [ ] [Review][Patch] Cache-hit path unconditionally increments `transcripts_extracted` even when `cached["parse_status"] != "SUCCESS"` — asymmetric with non-cache path which guards on `best_status == "SUCCESS"` [ml-sidecar/src/services/ingestion_service.py]
- [x] [Review][Defer] `_reconstruct_financials_result` raises uncaught `ValidationError` if DB JSONB row has schema not matching current `FinancialMetric` — pre-existing future risk; handle in a schema-evolution story [ml-sidecar/src/services/financials_service.py] — deferred, pre-existing
- [x] [Review][Defer] `PARTIAL` financials cached permanently with no invalidation mechanism — SUCCESS data from a later EDGAR fetch is never used once PARTIAL is stored; deliberate spec choice, revisit with TTL story [ml-sidecar/src/db/queries.py] — deferred, pre-existing
- [x] [Review][Defer] `fetch_duration_ms` in financials cache-miss log includes fast-path DB check and lock wait, not only EDGAR fetch — misleading for performance monitoring; fix label or move `start_time` in a future observability story [ml-sidecar/src/services/financials_service.py] — deferred, pre-existing
