# Story 5.1: BullMQ Async Analysis Job Queue

Status: ready-for-dev

## Story

As a **developer**,
I want a BullMQ-backed job queue in NestJS that accepts ticker analysis requests, manages the full async job lifecycle, and triggers the FastAPI ML sidecar,
So that a fresh ticker analysis can run as a background job of up to 3 minutes without blocking the API caller.

## Acceptance Criteria

1. **Given** a client sends `POST /api/v1/companies/:ticker/analyze`
   **When** the ticker has no cached data in PostgreSQL
   **Then** NestJS enqueues a BullMQ job and returns `{ "jobId": "<uuid>", "status": "QUEUED" }` with HTTP 202
   **And** the job is persisted to Redis so it survives an api service restart

2. **Given** a BullMQ worker picks up the job
   **When** it begins processing
   **Then** it calls `MlSidecarService` which POSTs to `http://ml-sidecar:8000/analyze/{ticker}`
   **And** the `analysis_jobs` table is updated to `status: "RUNNING"` via Drizzle

3. **Given** a client sends `POST /api/v1/companies/:ticker/analyze` for a ticker with complete cached data
   **When** NestJS checks PostgreSQL
   **Then** it returns `{ "jobId": null, "status": "COMPLETED", "cached": true }` with HTTP 200 — no new job is enqueued (FR5)

4. **Given** the ML sidecar returns an error or times out after max retries
   **When** the BullMQ worker handles the failure
   **Then** the `analysis_jobs` table is updated to `status: "FAILED"` with the error reason
   **And** a structured log entry is emitted with `jobId`, `ticker`, `error`, `timestamp`

5. **Given** the `analysis_jobs.status` is inspected at any point
   **When** a developer reads the value
   **Then** it is one of `QUEUED`, `RUNNING`, `COMPLETED`, or `FAILED` in SCREAMING_SNAKE_CASE — never any other value

## Tasks / Subtasks

- [ ] Task 1: Add dependencies to `api/package.json` (AC: 1, 2)
  - [ ] `npm install @nestjs/bullmq bullmq` (both runtime deps)
  - [ ] Confirm `ioredis` is pulled transitively by `bullmq`; do not add it directly
  - [ ] Verify `npm run build` and `npm test` still pass after install

- [ ] Task 2: Register the BullMQ root + queue (AC: 1)
  - [ ] Add `BullModule.forRootAsync` to `AppModule`, reading the Redis connection from `REDIS_URL` via `ConfigService` (already Joi-validated in `app.config.ts`)
  - [ ] Parse `REDIS_URL` into BullMQ `connection` options (host, port, password, family) — see Dev Notes
  - [ ] Register a named queue `analysis` via `BullModule.registerQueue({ name: 'analysis' })` inside `JobsModule`

- [ ] Task 3: Create `api/src/jobs/dto/` response contracts (AC: 1, 3, 5)
  - [ ] `AnalyzeResponseDto`: discriminated by `status` — `{ jobId: string; status: 'QUEUED' }` | `{ jobId: null; status: 'COMPLETED'; cached: true }`
  - [ ] Re-export the canonical `JobStatus` union derived from `schema.ts` `jobStatusEnum` — never redefine the string literals locally

- [ ] Task 4: Create `JobsService` `api/src/jobs/jobs.service.ts` (AC: 1, 2, 3, 5)
  - [ ] `requestAnalysis(ticker)`: ensure a `companies` row exists (insert-if-missing — minimal here; full company CRUD is 5.4), check cache, else create `analysis_jobs` row (`status: QUEUED`) and add a BullMQ job carrying `{ jobId, ticker }`
  - [ ] `isCached(companyId)`: returns true only when a prior job for the company reached `COMPLETED` — see Dev Notes on the cache-completeness definition (coordinate with 3.6 / 5.4)
  - [ ] `markRunning(jobId)` / `markFailed(jobId, error)`: Drizzle updates to `analysis_jobs.status` using the enum values only
  - [ ] All status writes go through a single private helper so SCREAMING_SNAKE_CASE values are centralised (AC5)

- [ ] Task 5: Create `JobsController` `api/src/jobs/jobs.controller.ts` (AC: 1, 3)
  - [ ] `POST companies/:ticker/analyze` → `JobsService.requestAnalysis()`; HTTP 202 for new job, HTTP 200 for cached (set status code explicitly per branch)
  - [ ] Validate `:ticker` via a DTO/param pipe (uppercase, `^[A-Z.]{1,10}$`); reject invalid with the standard error shape
  - [ ] No auth, no PII (FR30, NFR15)

- [ ] Task 6: Create the BullMQ worker `api/src/jobs/analysis.processor.ts` (AC: 2, 4)
  - [ ] `@Processor('analysis')` extending `WorkerHost`; on job: `markRunning`, call `MlSidecarService.analyze(ticker)`, handle terminal outcome
  - [ ] On sidecar error/timeout after retries: `markFailed(jobId, reason)` + structured log (`jobId`, `ticker`, `error`, `timestamp`) (AC4)
  - [ ] Note: the job is NOT marked `COMPLETED` here — completion is driven by the FastAPI webhook in 5.3. This worker's success path only confirms the sidecar accepted the run (`RUNNING`). Document this boundary in code.

- [ ] Task 7: Extend `MlSidecarService` (AC: 2)
  - [ ] Add `analyze(ticker)`: `POST {ML_SIDECAR_URL}/analyze/{ticker}`, reuse the existing `timeout` + `catchError` → `ServiceUnavailableException` pattern from `getHealth()`
  - [ ] Keep the ML sidecar URL confined to `MlSidecarService` (architecture boundary — no other module calls FastAPI directly)

- [ ] Task 8: Wire `JobsModule` into `AppModule` (AC: 1)
  - [ ] Import `JobsModule`; ensure `MlSidecarService` is available to it (it is exported from `AppModule` today — consider moving `MlSidecarService` into a shared `CommonModule` or providing it in `JobsModule` to avoid a circular import; see Dev Notes)

- [ ] Task 9: Write tests (AC: 1–5)
  - [ ] `jobs.service.spec.ts`: cached ticker returns `COMPLETED/cached` and enqueues nothing (AC3); uncached enqueues + writes `QUEUED` (AC1); status writes only ever use enum values (AC5)
  - [ ] `jobs.controller.spec.ts`: 202 vs 200 status codes per branch; invalid ticker rejected
  - [ ] `analysis.processor.spec.ts`: success → `markRunning` + sidecar called (AC2); sidecar failure → `markFailed` + log (AC4)
  - [ ] Mock BullMQ `Queue` and the `DRIZZLE` provider; mock `MlSidecarService` — no real Redis/DB/sidecar in unit tests

## Dev Notes

### What This Story Builds

A new `api/src/jobs/` module (controller + service + BullMQ processor + DTOs) and a one-method addition to `MlSidecarService`. This is the **anchor of the Epic 5 API track** — it owns the `POST .../analyze` endpoint and the `analysis_jobs` lifecycle. It does NOT build:

- The SSE progress endpoint (5.2) or the FastAPI→NestJS webhook receiver (5.3) — this worker leaves the job in `RUNNING`; `COMPLETED`/`FAILED`-on-success transitions arrive via 5.3's webhook.
- The `GET /companies/:ticker` lookup, search, or the full companies CRUD (5.4) — this story only does the minimal insert-if-missing needed to attach a job to a `companyId` FK.
- Any claims / score endpoints (5.5 / 5.6) or caching logic on the ML side (3.6).

### Endpoint Overlap with 5.4 — Coordinate

Both 5.1 and 5.4 define behaviour of `POST /api/v1/companies/:ticker/analyze`. 5.1 owns: enqueue, job lifecycle, cached short-circuit. 5.4 owns: creating/returning the `companies` record and `GET` lookup. Keep the company write here minimal (insert-if-missing returning `id`) and let 5.4 formalise it. Whoever picks up 5.4 second should reuse `JobsService`'s ensure-company helper rather than duplicating it. Flag in the PR.

### File Locations

```
api/src/
  jobs/
    jobs.module.ts          ← NEW
    jobs.controller.ts      ← NEW
    jobs.service.ts         ← NEW
    analysis.processor.ts   ← NEW
    dto/
      analyze-response.dto.ts  ← NEW
    jobs.service.spec.ts       ← NEW (Task 9)
    jobs.controller.spec.ts    ← NEW (Task 9)
    analysis.processor.spec.ts ← NEW (Task 9)
  common/
    ml-sidecar.service.ts   ← MODIFIED (add analyze())
  app.module.ts             ← MODIFIED (BullModule.forRootAsync + JobsModule)
package.json                ← MODIFIED (@nestjs/bullmq, bullmq)
```

[Source: architecture.md — NestJS Project Structure: feature modules under `src/`; epics.md Epic 5 layer `[API]`]

### Redis Connection (REDIS_URL → BullMQ)

`REDIS_URL` is already required + validated in `app.config.ts` and the Redis 7 service is healthy-gated in `docker-compose.yml`. BullMQ wants ioredis-style `connection` options, so parse the URL:

```ts
// in app.module.ts BullModule.forRootAsync useFactory
const url = new URL(config.getOrThrow<string>('REDIS_URL'));
return {
  connection: {
    host: url.hostname,
    port: Number(url.port) || 6379,
    password: url.password || undefined,
    // family: 0  // enable if deploying to a dual-stack host (Railway)
  },
};
```

Do not hardcode `redis:6379`. The compose value is `redis://redis:6379`.

[Source: api/src/config/app.config.ts — REDIS_URL Joi.required(); docker-compose.yml redis service]

### Job Lifecycle / Status Source of Truth

The canonical statuses live in `api/src/db/schema.ts` as `jobStatusEnum` (`QUEUED | RUNNING | COMPLETED | FAILED`). Derive the TS type from it — never re-type the literals:

```ts
import { jobStatusEnum } from '../db/schema';
export type JobStatus = (typeof jobStatusEnum.enumValues)[number];
```

Lifecycle in Phase 1:
- `QUEUED` — written synchronously when the job row is created (this story).
- `RUNNING` — written by the worker when it dispatches to the sidecar (this story, AC2).
- `COMPLETED` — written by the **webhook receiver in 5.3** on the `analysis-complete` event (NOT this story).
- `FAILED` — written by the worker on sidecar failure (this story, AC4) OR by 5.3 on `analysis-failed`.

[Source: epics.md Story 5.1 AC2/AC4/AC5; SP2 canonical enum lock — dev-plan.md:192]

### Cache-Completeness Definition (AC3)

AC3 returns `COMPLETED/cached` when the ticker has "complete cached data." For Phase 1 scaffolding, define "cached" as: the company exists AND its most recent `analysis_jobs` row is `COMPLETED`. The richer definition (transcripts + verdicts present for the requested quarters) is owned by the ML caching story (3.6) and the claims endpoints (5.5). Leave a `TODO(3.6/5.5)` at the cache check and keep the check in one method (`isCached`) so it can be tightened later without touching the controller.

[Source: epics.md Story 5.1 AC3 (FR5); Story 3.6 caching]

### DB Access Pattern

Inject the Drizzle instance via the existing token — the `DrizzleModule` is `@Global()`, so no import needed in `JobsModule`:

```ts
import { Inject } from '@nestjs/common';
import { DRIZZLE, DrizzleDB } from '../db/drizzle.module';
// constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}
```

Use `db.insert(companies)...onConflictDoNothing()` / `.returning()` and `db.update(analysisJobs).set({ status }).where(eq(analysisJobs.id, jobId))`. `analysis_jobs.companyId` is a NOT NULL FK to `companies.id`.

[Source: api/src/db/drizzle.module.ts — DRIZZLE token, @Global; api/src/db/schema.ts — companies, analysisJobs]

### MlSidecarService Provider Wiring (avoid circular import)

`MlSidecarService` is currently declared in `AppModule` and exported. If `JobsModule` imports `AppModule` to access it, that's a cycle. Cleanest fix: extract a `CommonModule` that provides + exports `MlSidecarService` (and `HttpModule`), import it from both `AppModule` and `JobsModule`. Acceptable alternative for a small scaffold: declare `MlSidecarService` as a provider directly inside `JobsModule`. Pick one and note it in the PR; prefer the `CommonModule` extraction since 5.2/5.3 will also need shared providers.

[Source: api/src/app.module.ts — MlSidecarService currently provided/exported by AppModule]

### Structured Logging

Use the NestJS Winston logger already wired in `main.ts`. Log on failure with the exact AC4 fields:

```ts
this.logger.error('Analysis job failed', {
  service: 'api', jobId, ticker, error: String(err), timestamp: new Date().toISOString(),
});
```

No `console.log` anywhere (enforced by 1.4 lint rules).

[Source: story 1.4 — logging interceptor + nest-winston; architecture.md Logging Guidelines]

### Test Strategy

- Unit tests only in this story (`*.spec.ts`, `rootDir: src`, Jest config in `package.json`). No e2e here.
- Mock the BullMQ `Queue` (`getQueueToken('analysis')`), the `DRIZZLE` provider, and `MlSidecarService`. Do not stand up Redis/Postgres/sidecar.
- Follow the existing spec pattern in `api/src/common/*.spec.ts` for `Test.createTestingModule` + provider overrides.

[Source: api/package.json jest config; existing api/src/common/*.spec.ts]

### Does Not Touch

- `api/src/db/schema.ts` — schema is locked (SP1). No new tables/columns in this story.
- `frontend/**`, `ml-sidecar/**` — the FastAPI `/analyze/{ticker}` stub already exists from 1.3; do not modify it here.
- SSE (5.2), webhook receiver (5.3), company GET/search (5.4).

### References

- [Source: epics.md — Story 5.1: full acceptance criteria]
- [Source: dev-plan.md — Track API; SP2 enum lock; recommended pickup order item 4]
- [Source: api/src/db/schema.ts — jobStatusEnum, companies, analysisJobs]
- [Source: api/src/db/drizzle.module.ts — DRIZZLE token, @Global module]
- [Source: api/src/common/ml-sidecar.service.ts — existing getHealth() pattern]
- [Source: api/src/config/app.config.ts — REDIS_URL validation]
- [Source: docker-compose.yml — redis service, api depends_on redis healthy]

## Dev Agent Record

### Agent Model Used

(scaffold authored by claude-opus-4-7; implementation TBD)

### Debug Log References

### Completion Notes List

- Scaffold only: module/controller/service/processor/dtos created with structure and AC-mapped TODOs; BullMQ deps NOT yet installed (Task 1 pending).

### File List

- _bmad-output/implementation-artifacts/5-1-bullmq-async-analysis-job-queue.md
- api/src/jobs/jobs.module.ts
- api/src/jobs/jobs.controller.ts
- api/src/jobs/jobs.service.ts
- api/src/jobs/analysis.processor.ts
- api/src/jobs/dto/analyze-response.dto.ts
- api/src/common/ml-sidecar.service.ts (modified)
- api/src/app.module.ts (modified)
- api/package.json (modified)

## Change Log

- 2026-05-26: Story drafted and module scaffolded by claude-opus-4-7. Structure + AC-mapped task list in place; BullMQ dependency install and implementation pending pickup.
