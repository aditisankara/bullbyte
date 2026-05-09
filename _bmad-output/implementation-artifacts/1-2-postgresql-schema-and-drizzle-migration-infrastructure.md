# Story 1.2: PostgreSQL Schema & Drizzle Migration Infrastructure

Status: done

## Story

As a **developer**,
I want the PostgreSQL schema defined in Drizzle ORM and applied via Drizzle Kit migrations at API startup,
so that all services share a single authoritative data model that is version-controlled and reproducible.

## Acceptance Criteria

1. **Given** the api service starts via Docker Compose
   **When** Drizzle's migrate function runs at bootstrap
   **Then** all six tables are created: `companies`, `analysis_jobs`, `claims`, `verdicts`, `reasoning_traces`, `tool_call_logs`
   **And** all columns, types, constraints, and indexes match `api/src/db/schema.ts`

2. **Given** the schema is applied
   **When** a developer inspects `verdicts`
   **Then** it has no `updated_at` column — only `created_at` — enforcing the append-only model at the schema level (NFR7)
   **And** corrections are represented by `is_correction BOOLEAN DEFAULT false` and `corrects_verdict_id UUID NULL FK`

3. **Given** the schema is applied
   **When** a developer inspects `claims`
   **Then** `quarter` is stored as `TEXT` (format `"Q3-2024"`) and `extraction_confidence` as `NUMERIC` between 0 and 1

4. **Given** migrations have already run and the api service restarts
   **When** Drizzle's migrate function runs again
   **Then** it detects no pending migrations and starts without error
   **And** no data loss or duplicate tables occur

5. **Given** `api/src/db/schema.ts`
   **When** a developer adds a new table in a future story
   **Then** they generate a migration with `npm run db:generate` and it applies cleanly on the next service start

## Tasks / Subtasks

- [x] Task 1: Define Drizzle schema (AC: 1, 2, 3)
  - [x] Create `api/src/db/schema.ts` with all 6 tables, enums, and type exports
  - [x] Use UUID PKs, snake_case column names, proper FK references
  - [x] Ensure `verdicts` has no `updated_at`; has `is_correction` + `corrects_verdict_id`
  - [x] Fix `reasoning_traces.verdictId` → `verdict_id` (snake_case enforcement)
  - [x] Fix `reasoning_traces.createdAt` from `text` to `timestamp`
  - [x] Add missing `created_at` to `companies`, `analysis_jobs`, `claims`
  - [x] Add `idx_claims_company_id` index per architecture spec

- [x] Task 2: Configure Drizzle Kit (AC: 5)
  - [x] Create `api/drizzle.config.ts` at project root with `dialect: postgresql`, correct schema/out paths
  - [x] Add `db:generate` and `db:migrate` npm scripts to `api/package.json`
  - [x] Update `api/nest-cli.json` to copy migration SQL files as build assets

- [x] Task 3: Wire DrizzleModule into NestJS (AC: 1, 4)
  - [x] Create `api/src/db/drizzle.module.ts` — global NestJS module; creates pg.Pool + drizzle instance; runs migrate on startup
  - [x] Create `api/src/config/database.config.ts` — exports DATABASE_URL
  - [x] Update `api/src/app.module.ts` to import DrizzleModule

- [x] Task 4: Regenerate migration to match corrected schema (AC: 1)
  - [x] Fix `api/src/db/migrations/0000_certain_warbird.sql` to reflect corrected schema
  - [x] Fix `api/src/db/migrations/meta/0000_snapshot.json` to match

- [x] Task 5: asyncpg helpers for ml-sidecar (AC: 1)
  - [x] Add `asyncpg` to `ml-sidecar/pyproject.toml` dependencies
  - [x] Create `ml-sidecar/src/db/__init__.py`
  - [x] Create `ml-sidecar/src/db/pool.py` — asyncpg connection pool factory
  - [x] Create `ml-sidecar/src/db/queries.py` — typed write helpers for claims, verdicts, reasoning traces, tool call logs

- [x] Task 6: Tests (AC: 1, 2, 3)
  - [x] Write `api/src/db/schema.spec.ts` — validates all 6 tables exist, correct names, verdicts immutability
  - [x] Run full NestJS test suite; confirm no regressions

## Dev Notes

### Architecture Requirements
- **ORM / Query Layer — NestJS:** Drizzle ORM with Drizzle Kit for migrations
- **DB Access — FastAPI ML Sidecar:** asyncpg directly (no ORM) — sidecar writes via `db/queries.py`
- **Migrations:** Run at api service startup via `drizzle-orm/node-postgres/migrator` (NOT drizzle-kit at runtime)
- **Schema ownership:** NestJS (`api/src/db/schema.ts`) — single migration authority

### Naming Conventions (canonical)
- Tables: snake_case plural
- Columns: snake_case
- PKs: `id` UUID v4 on all tables
- FKs: `{referenced_table_singular}_id`
- Timestamps: `created_at` on EVERY table (no `updated_at` in Phase 1 — append-only)
- Indexes: `idx_{table}_{column(s)}`

### Canonical Data Formats
- Verdict values: `DELIVERED | MISSED | REVISED | PENDING | INSUFFICIENT_DATA`
- Job status: `QUEUED | RUNNING | COMPLETED | FAILED`
- Quarter format: `"Q3-2024"` (kebab text, never anything else)
- Confidence score: `number` 0–1 (e.g. `0.87`)

### Migration Strategy
- drizzle-orm's `migrate()` function runs at NestJS bootstrap — no drizzle-kit needed at runtime
- Migration SQL files are copied to `dist/db/migrations/` via `nest-cli.json` assets
- `drizzle-kit generate` is a dev-time tool only (`npm run db:generate`)

### References
- Architecture: `_bmad-output/planning-artifacts/architecture.md`
- Epics: `_bmad-output/planning-artifacts/epics.md`

---

## Review Findings

**Code Review Complete** — 5 `decision-needed`, 10 `patch`, 2 `defer`, 1 dismissed.

### Decision-Needed (Require Your Choice)

- [x] [Review][Decision] FK cascade policy: verdicts → claims — Spec silent on behavior when claim deleted; current `ON DELETE NO ACTION` means deleting a company cascades through to claims but then blocks at verdicts level. **Options:** (A) CASCADE — delete verdicts when their claim is deleted **(B)** RESTRICT — disallow claim delete if verdicts exist (note: claim_id is NOT NULL so SET NULL is invalid)
- [x] [Review][Decision] FK cascade policy: reasoning_traces → verdicts — `ON DELETE NO ACTION` means deleting a verdict leaves reasoning_traces with a dangling verdict_id (no NOT NULL constraint), silently orphaning audit trail rows. **Options:** (A) CASCADE **(B)** RESTRICT **(C)** Make verdict_id NOT NULL + CASCADE
- [x] [Review][Decision] FK cascade policy: tool_call_logs → analysis_jobs — Same issue: job_id is nullable with no onDelete, logs orphaned on job delete. **Options:** (A) CASCADE **(B)** RESTRICT **(C)** Make job_id NOT NULL + CASCADE
- [x] [Review][Decision] Multi-replica migration concurrency — `migrate()` runs at NestJS bootstrap with no advisory lock; two replicas starting simultaneously will race on the migration journal, risking DDL errors or corruption. **Options:** (A) Document single-replica deployment assumption for Phase 1 **(B)** Add `pg_advisory_lock` around migrate()
- [x] [Review][Decision] Timestamp timezone consistency — all `created_at` columns are plain `timestamp` (timezone-naive) but `last_analysed_at` is `timestamp with time zone`; inconsistency risks ambiguity in multi-timezone deployments. **Options:** (A) Add `{ withTimezone: true }` to all `created_at` columns + regenerate migration **(B)** Keep as-is and document timezone-naive assumption

### Patches (Fixable Without Your Input)

- [x] [Review][Patch] Pool never closed on app shutdown — `api/src/db/drizzle.module.ts` — Add `OnModuleDestroy` hook; call `pool.end()` on shutdown to avoid connection exhaustion under redeploys
- [x] [Review][Patch] Pool leak on migrate() failure — `api/src/db/drizzle.module.ts:18-27` — Wrap `migrate()` in try-finally; close pool if migration throws, preventing leaked TCP connections
- [x] [Review][Patch] Python pool race condition on concurrent first call — `ml-sidecar/src/db/pool.py:8-16` — Two concurrent coroutines both see `_pool is None` before await completes; add `asyncio.Lock` to make initialization atomic
- [x] [Review][Patch] NUMERIC(4,3) allows values outside [0,1] — `api/src/db/schema.ts:66,87` + `api/src/db/migrations/0000_certain_warbird.sql` — Add `CHECK (extraction_confidence >= 0 AND extraction_confidence <= 1)` and `CHECK (confidence_score >= 0 AND confidence_score <= 1)` to SQL migration; values up to 9.999 currently accepted silently
- [x] [Review][Patch] corrects_verdict_id can reference its own row — `api/src/db/schema.ts` (verdicts table) — A verdict with `corrects_verdict_id = id` creates an infinite correction chain; add `CHECK (corrects_verdict_id != id)` to migration SQL
- [x] [Review][Patch] is_correction=True with corrects_verdict_id=None not caught — `ml-sidecar/src/db/queries.py:insert_verdict` — A semantically corrupt record (is_correction=True but no reference) is accepted by both Python and DB; add guard: `if is_correction and not corrects_verdict_id: raise ValueError(...)`
- [x] [Review][Patch] JSONB input not validated for serializability — `ml-sidecar/src/db/queries.py:insert_tool_call_log` — `json.dumps(input)` raises TypeError on unserializable objects (e.g., custom classes, datetime); wrap in try-except with clear error message before `pool.execute()`
- [x] [Review][Patch] CREATE TYPE missing IF NOT EXISTS — `api/src/db/migrations/0000_certain_warbird.sql:1-2` — `CREATE TYPE "public"."job_status"` without `IF NOT EXISTS` fails on re-run against a DB where a prior partial migration left the type; add `IF NOT EXISTS` to both CREATE TYPE statements
- [x] [Review][Patch] database.config.ts is dead code — `api/src/config/database.config.ts` — Exports `databaseConfig.url` but `drizzle.module.ts` reads `process.env.DATABASE_URL` directly; file is never imported anywhere; remove or wire it up
- [x] [Review][Patch] No fail-fast when DATABASE_URL is absent in production — `api/src/db/drizzle.module.ts:19` — Hardcoded fallback `localhost:5432` is silently used if env var is missing; add guard: `if (process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL) throw new Error(...)`

### Deferred (Not Actionable Now)

- [x] [Review][Defer] Missing FK indexes on analysis_jobs.company_id, verdicts.claim_id, reasoning_traces.verdict_id, tool_call_logs.job_id — Performance optimization; only idx_claims_company_id is required by current spec; add remaining FK indexes in a future perf story
- [x] [Review][Defer] analysisJobs table has no status transition timestamps (started_at, finished_at) — Out of scope for Phase 1 append-only model; useful for debugging stuck jobs but not required until job monitoring story

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

- All 6 tables created with correct snake_case column names, UUID PKs, FK constraints, and `created_at` on every table.
- Fixed 3 pre-existing bugs in schema.ts: `reasoning_traces.verdictId` DB column name (was camelCase `'verdictId'`, fixed to `'verdict_id'`); `reasoning_traces.createdAt` type (was `text`, fixed to `timestamp`); missing `created_at` on `companies`, `analysis_jobs`, `claims`.
- Added `idx_claims_company_id` btree index per architecture spec.
- `DrizzleModule` is a `@Global()` NestJS module — runs `migrate()` at bootstrap so migration SQL is applied before the app accepts requests. Migration files are copied to `dist/` via `nest-cli.json` assets configuration.
- `drizzle.config.ts` placed at `api/` project root (standard location); `api/src/drizzle.config.ts` left as an untracked orphan — it is superseded and can be deleted.
- asyncpg write helpers in `ml-sidecar/src/db/queries.py` follow the append-only constraint: no UPDATE paths, verdict_type validated against enum before insert.
- 18/18 NestJS tests pass; 0 TypeScript compile errors after adding `"types": ["jest", "node"]` to tsconfig.json.

### File List

- `api/src/db/schema.ts` (UPDATED — fixed reasoning_traces column names/types; added created_at to companies, analysis_jobs, claims; added idx_claims_company_id index)
- `api/src/db/migrations/0000_certain_warbird.sql` (UPDATED — regenerated to match corrected schema)
- `api/src/db/migrations/meta/0000_snapshot.json` (UPDATED — regenerated to match corrected schema)
- `api/drizzle.config.ts` (NEW — project-root config with correct src/ paths)
- `api/package.json` (UPDATED — added db:generate and db:migrate scripts)
- `api/nest-cli.json` (UPDATED — added migration SQL files as build assets)
- `api/src/db/drizzle.module.ts` (NEW)
- `api/src/config/database.config.ts` (NEW)
- `api/src/app.module.ts` (UPDATED — imports DrizzleModule)
- `api/src/db/schema.spec.ts` (NEW)
- `ml-sidecar/pyproject.toml` (UPDATED — added asyncpg)
- `ml-sidecar/src/db/__init__.py` (NEW)
- `ml-sidecar/src/db/pool.py` (NEW)
- `ml-sidecar/src/db/queries.py` (NEW)

### Change Log

- 2026-05-01: Story created and partially implemented by prior attempt (schema.ts + initial migration)
- 2026-05-01: Fixed schema bugs; completed all missing NestJS wiring, asyncpg helpers, tests (claude-sonnet-4-6)
