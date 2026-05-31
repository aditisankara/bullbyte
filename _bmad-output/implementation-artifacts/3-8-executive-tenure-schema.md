# Story 3.8: Executive Tenure Schema

Status: review

## Story

As a **developer**,
I want an `executives` table in PostgreSQL that records which person held which C-suite role at which company and when,
So that Epic 4's CEO delivery score (story 4.6) can roll up per-quarter verdicts to a named individual rather than just a ticker.

## Acceptance Criteria

1. **Given** the Drizzle schema file `api/src/db/schema.ts`
   **When** this story is complete
   **Then** it contains an `executives` table with columns: `id` (UUID PK), `person_name` (text), `company_id` (UUID FK → companies), `role` (text), `start_date` (text `YYYY-MM-DD`), `end_date` (text `YYYY-MM-DD`, nullable), `created_at` (timestamptz)
   **And** a composite index on `(company_id, role)` for efficient CEO lookup by company

2. **Given** the Drizzle migration is generated via `npx drizzle-kit generate` from the `api/` directory
   **When** the migration runs (at NestJS startup via `DrizzleModule`)
   **Then** a `CREATE TABLE "executives"` statement executes without error on a clean database
   **And** the FK constraint on `company_id` references `companies(id)` with `ON DELETE CASCADE`

3. **Given** `ml-sidecar/src/db/queries.py`
   **When** this story is complete
   **Then** it contains a `get_executive_at_date(ticker, role, date)` helper that returns the `asyncpg.Record` for the person holding `role` at `ticker`'s company on `date`, or `None` if no matching row exists
   **And** it follows the same pool-fetch pattern as all other helpers in that file

4. **Given** `api/src/db/schema.ts` is the single schema authority
   **When** the migration file is committed
   **Then** the column names in the migration SQL match the `snake_case` column definitions in schema.ts exactly
   **And** no manual edits are made to the generated SQL file

5. **Given** the exported TypeScript types
   **When** this story is complete
   **Then** `Executive` and `NewExecutive` types are exported from `schema.ts` via `$inferSelect` / `$inferInsert`

6. **Given** `ml-sidecar/tests/` test suite
   **When** this story is complete
   **Then** a test file `test_executive_queries.py` exists with at least 3 tests:
   - `test_get_executive_at_date_found` — mock pool returns a matching row, assert correct record returned
   - `test_get_executive_at_date_not_found` — mock pool returns None, assert None returned
   - `test_get_executive_at_date_end_date_exclusive` — mock pool returns None for a date after end_date, assert None

## Tasks / Subtasks

- [x] Task 1: Add `executives` table to `api/src/db/schema.ts` (AC: 1, 2, 5)
  - [x] Add after the `financialActuals` table definition (bottom of file, before closing)
  - [x] Import no new Drizzle functions — `uuid`, `text`, `timestamp`, `index`, `pgTable` are already imported
  - [x] Table definition (exact shape):
    ```typescript
    export const executives = pgTable(
      'executives',
      {
        id: uuid('id').primaryKey().defaultRandom(),
        personName: text('person_name').notNull(),
        companyId: uuid('company_id')
          .notNull()
          .references(() => companies.id, { onDelete: 'cascade' }),
        role: text('role').notNull(),       // 'CEO', 'CFO', etc.
        startDate: text('start_date').notNull(), // 'YYYY-MM-DD'
        endDate: text('end_date'),              // null = currently in role
        createdAt: timestamp('created_at', { withTimezone: true })
          .defaultNow()
          .notNull(),
      },
      (t) => [
        index('idx_executives_company_role').on(t.companyId, t.role),
        index('idx_executives_person_name').on(t.personName),
      ]
    );

    export type Executive = typeof executives.$inferSelect;
    export type NewExecutive = typeof executives.$inferInsert;
    ```
  - [x] Verify no existing table uses the name `executives` — it does not

- [x] Task 2: Generate and commit the Drizzle migration (AC: 2, 4)
  - [x] From the `api/` directory, run: `npx drizzle-kit generate`
  - [x] Confirm a new file is created in `api/src/db/migrations/` (will be named `0002_*.sql`)
  - [x] Inspect the SQL: it must contain `CREATE TABLE "executives"` with all 7 columns and the FK constraint
  - [x] Commit the generated file as-is — do NOT edit manually

- [x] Task 3: Add `get_executive_at_date` query helper in `ml-sidecar/src/db/queries.py` (AC: 3)
  - [x] Add a new section `# executives` at the bottom of the file (after `tool_call_logs`)
  - [x] Implement the helper:
    ```python
    async def get_executive_at_date(
        ticker: str,
        role: str,
        date: str,  # 'YYYY-MM-DD'
    ) -> asyncpg.Record | None:
        """Return the executive holding `role` at `ticker`'s company on `date`, or None.

        Looks up company_id from the companies table, then queries executives
        where start_date <= date AND (end_date IS NULL OR end_date >= date).
        Returns None if the ticker has no matching company row or no executive row.
        """
        pool = await get_pool()
        return await pool.fetchrow(
            """
            SELECT e.id, e.person_name, e.role, e.start_date, e.end_date
            FROM executives e
            JOIN companies c ON c.id = e.company_id
            WHERE c.ticker = $1
              AND e.role = $2
              AND e.start_date <= $3
              AND (e.end_date IS NULL OR e.end_date >= $3)
            ORDER BY e.start_date DESC
            LIMIT 1
            """,
            ticker,
            role,
            date,
        )
    ```
  - [x] `ORDER BY e.start_date DESC LIMIT 1` handles edge case where two rows overlap (most recent wins)

- [x] Task 4: Write tests in `ml-sidecar/tests/test_executive_queries.py` (AC: 6)
  - [x] Create new file; follow the pool-mock pattern from `test_caching.py`
  - [x] Use `unittest.mock.AsyncMock` to mock `get_pool` — same as other query tests
  - [x] Test 1: `test_get_executive_at_date_found`
    ```python
    async def test_get_executive_at_date_found():
        mock_record = {"id": "...", "person_name": "Tim Cook", "role": "CEO",
                       "start_date": "2011-08-24", "end_date": None}
        with patch("src.db.queries.get_pool", new_callable=AsyncMock) as mock_pool:
            mock_pool.return_value.fetchrow = AsyncMock(return_value=mock_record)
            result = await get_executive_at_date("AAPL", "CEO", "2024-10-01")
        assert result["person_name"] == "Tim Cook"
    ```
  - [x] Test 2: `test_get_executive_at_date_not_found` — `fetchrow` returns `None`, assert result is `None`
  - [x] Test 3: `test_get_executive_at_date_query_passes_correct_params` — assert `fetchrow` called with ticker, role, and date as positional args in correct order

## Dev Notes

### Context: why this story exists

Epic 4 story 4.6 computes a "CEO Delivery Score" — a person-level credibility score that:
- Aggregates all resolved verdicts for a company-quarter
- Maps them back to the CEO who was leading the company at that time
- Rolls up across all companies/tenures that person led

Without a tenure table, 4.6 can only produce ticker-level scores ("AAPL Q3-2024: 3/5 delivered"). With it, scores become person-level ("Tim Cook: 78% keep rate across 52 verified claims at Apple"). The person-level score is the product differentiator — it's portable across companies and persistent across management changes.

**This story is schema-only. No data seeding is required.** The `executives` table will be populated either manually for demo tickers before Epic 4 demo, or by a future story that fetches CEO tenure from a data source. The query helper is needed now so Epic 4 dev agents can call it.

### Schema authority rules (critical — do not violate)

From architecture:
- `api/src/db/schema.ts` is the **single schema authority**. The ML sidecar NEVER defines tables or runs migrations.
- `ml-sidecar/src/db/queries.py` uses `snake_case` SQL column names that match schema.ts exactly. Drizzle maps to camelCase TypeScript automatically — the sidecar does not use Drizzle at all.
- Migration files in `api/src/db/migrations/` are generated by `npx drizzle-kit generate` and committed as-is. They run automatically at NestJS startup via `DrizzleModule`.

### Date format consistency

The entire codebase uses `text` columns with `'YYYY-MM-DD'` format for dates that need to be readable across languages (Python `datetime.strptime(..., "%Y-%m-%d")`, TypeScript `new Date(...)`). This is the same pattern as `filing_date` in `transcripts` and `start_date`/`end_date` in other models.

**Do not use `date` PostgreSQL type** — the project consistently uses `text` for date columns in sidecar-facing tables to avoid asyncpg timezone conversion edge cases.

### `get_executive_at_date` design

The function joins `executives → companies` rather than accepting `company_id` directly because:
- The sidecar always works with ticker symbols (e.g. `"AAPL"`), never with internal UUIDs
- The company_id UUID is only in NestJS/Drizzle's domain
- This keeps the sidecar API ergonomic and consistent with `get_cached_transcript(ticker, quarter)`

The `ORDER BY e.start_date DESC LIMIT 1` guard handles the case where a company had multiple CEO transitions within the query window — the most recently started role wins. In practice this should never happen, but the guard prevents silent multi-row returns.

### Pool mock pattern for tests

From `conftest.py`, the `_env` fixture sets `DATABASE_URL` for all tests. Query tests mock `get_pool` directly:

```python
from unittest.mock import AsyncMock, patch
from src.db.queries import get_executive_at_date

async def test_get_executive_at_date_found():
    mock_pool = AsyncMock()
    mock_pool.fetchrow = AsyncMock(return_value={"person_name": "Tim Cook", ...})
    with patch("src.db.queries.get_pool", return_value=mock_pool):
        result = await get_executive_at_date("AAPL", "CEO", "2024-10-01")
    assert result is not None
```

Note: `get_pool` is an `async def` so patch with `return_value`, not `new_callable=AsyncMock`.

### Future: data seeding for demo tickers

Before the Epic 4 demo, the `executives` table needs CEO records for at least the 5 demo tickers (TSLA, AAPL, SPOT, META, NVDA). This is NOT in scope for story 3.8. Options for a future story or one-off migration:
- Manual INSERT statements in a new migration (`0003_seed_executives.sql`)
- A seeding script in `api/src/db/seeds/`
- Wikipedia/SEC proxy statement data for CEO tenure dates

The critical tenure dates to get right are the last 8 quarters (2022–2024) since that's the analysis window.

### NestJS migration run: no action needed

`DrizzleModule` at `api/src/db/drizzle.module.ts` calls `migrate()` on startup. The new migration (`0002_*.sql`) will run automatically the next time Docker Compose starts the `api` service. No CI or manual step needed.

### Project Structure Notes

- New files: `ml-sidecar/tests/test_executive_queries.py`
- Modified files: `api/src/db/schema.ts`, `ml-sidecar/src/db/queries.py`
- Generated (commit as-is): `api/src/db/migrations/0002_*.sql`
- Table naming follows architecture convention: `snake_case` plural → `executives`
- Column naming: `snake_case` → Drizzle auto-maps to `camelCase` in TypeScript
- Indexes: `idx_{table}_{column(s)}` → `idx_executives_company_role`, `idx_executives_person_name`

### References

- [Source: api/src/db/schema.ts] — full schema file; `executives` appended after line 207
- [Source: ml-sidecar/src/db/queries.py] — existing query helpers; new section added at bottom
- [Source: _bmad-output/planning-artifacts/architecture.md#Database Naming Conventions] — naming rules
- [Source: _bmad-output/planning-artifacts/architecture.md#Schema authority] — "NestJS owns all table definitions and migration files"
- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.6] — CEO Delivery Score Computation, the consumer of this table
- [Source: ml-sidecar/tests/test_caching.py] — pool mock pattern for query tests

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6 (story creation via bmad-create-story, 2026-05-29)
claude-sonnet-4-6 (implementation via bmad-dev-story, 2026-05-31)

### Debug Log References

### Completion Notes List

- Added `executives` table to `api/src/db/schema.ts` after `financialActuals`; no new imports needed
- Generated migration `api/src/db/migrations/0002_yielding_phil_sheldon.sql` via `npx drizzle-kit generate`; SQL verified: 7 columns, FK with ON DELETE cascade, 2 indexes
- Added `get_executive_at_date(ticker, role, date)` to `ml-sidecar/src/db/queries.py` under new `# executives` section; joins via ticker, ORDER BY start_date DESC LIMIT 1
- Created `ml-sidecar/tests/test_executive_queries.py` with 3 tests; patched `get_pool` with `return_value` per async coroutine pattern
- 136/136 tests pass, 0 regressions

### File List

- Modified: `api/src/db/schema.ts`
- Generated (committed as-is): `api/src/db/migrations/0002_yielding_phil_sheldon.sql`
- Modified: `ml-sidecar/src/db/queries.py`
- Created: `ml-sidecar/tests/test_executive_queries.py`
