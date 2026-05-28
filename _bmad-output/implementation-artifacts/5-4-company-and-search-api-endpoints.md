# Story 5.4: Company & Search API Endpoints

Status: review

## Story

As a **developer**,
I want NestJS API endpoints for ticker lookup and company summary retrieval,
So that the Angular frontend can look up companies and display the top-level data needed to render the research dashboard.

## Acceptance Criteria

1. **Given** `GET /api/v1/companies/:ticker`
   **When** the company exists in PostgreSQL
   **Then** the response is `{ "id", "ticker", "name", "lastAnalysedAt", "jobStatus" }` with HTTP 200, all field names camelCase (FR28, FR29)

2. **Given** `GET /api/v1/companies/:ticker`
   **When** the ticker does not exist
   **Then** the response is `{ "statusCode": 404, "error": "NOT_FOUND", "code": "TICKER_NOT_FOUND", "details": { "ticker": "XYZ" } }` — no stack trace

3. **Given** `POST /api/v1/companies/:ticker/analyze` for a new ticker
   **When** the request is processed
   **Then** a `companies` record is created if absent and a new `analysis_jobs` row is created with `status: "QUEUED"` before responding

4. **Given** any request
   **When** processed
   **Then** no auth token/session is required (FR30) and no PII is collected/logged/stored (NFR15)

## Tasks / Subtasks

- [x] Task 1: `CompaniesModule` under `api/src/companies/` (AC1, AC2)
  - [x] `companies.controller.ts`: `GET companies/:ticker`, validate ticker via the existing `TickerValidationPipe`
  - [x] `companies.service.ts`: `getSummary(ticker)` — read `companies` + most-recent `analysis_jobs.status`; throw `NotFoundException({ code: 'TICKER_NOT_FOUND', details: { ticker } })` when absent
  - [x] `dto/company-summary.dto.ts`: camelCase shape; `jobStatus` derived from the canonical `jobStatusEnum`
  - [x] Register `CompaniesModule` in `AppModule`

- [x] Task 2: Reconcile the POST analyze overlap with 5.1 (AC3)
  - [x] AC3 is **already satisfied** by 5.1's `JobsService` (ensureCompany + QUEUED job). Confirmed: `POST /api/v1/companies/:ticker/analyze` is owned by `JobsController` (`@Controller('companies/:ticker')` + `@Post('analyze')`). Not duplicated here.

- [x] Task 3: Relocate `TickerValidationPipe` to `common/` (optional, recommended)
  - [x] Moved `ticker-validation.pipe.ts` (+ spec) from `jobs/` to `api/src/common/`; updated both `jobs.controller.ts` and `companies.controller.ts` imports, removing the `companies → jobs` dependency.

- [x] Task 4: Tests (AC1, AC2)
  - [x] `companies.service.spec.ts`: existing ticker returns the summary with `jobStatus`; never-analysed ticker yields `null` `lastAnalysedAt`/`jobStatus`; missing ticker throws `NotFoundException` with the `TICKER_NOT_FOUND` payload
  - [x] `companies.controller.spec.ts`: delegates to the service. (Invalid-ticker rejection is covered by `common/ticker-validation.pipe.spec.ts`, since the pipe is applied by the framework, not in a unit-instantiated controller.)

## Dev Notes

### What This Story Builds
A read-only `GET /api/v1/companies/:ticker` summary endpoint and its module. The write side (`POST …/analyze`) is owned by 5.1 — this story must not re-implement it.

### The 404 error shape is automatic
The `AllExceptionsFilter` from 1.4 already maps a thrown `HttpException` whose response carries `code`/`details` into `{ statusCode, error, code, details }` (verified at runtime: the 5.1 ticker pipe throws `BadRequestException({ code:'INVALID_TICKER', details })` → `{statusCode:400,error:"BAD_REQUEST",code:"INVALID_TICKER",details}`). So `throw new NotFoundException({ code:'TICKER_NOT_FOUND', details:{ ticker } })` yields exactly AC2.

### DB access
Inject the global `DRIZZLE` token (`@Inject(DRIZZLE) db: DrizzleDB`). `jobStatus` = the most recent `analysis_jobs.status` for the company (`orderBy(desc(createdAt)).limit(1)`), or `null` if none. `lastAnalysedAt` comes from `companies.last_analysed_at` (a later story sets it on completion; may be `null` for now).

### camelCase
`schema.ts` already exposes camelCase column aliases (`lastAnalysedAt`), so the DTO maps cleanly. Serialise the timestamp with `.toISOString()`.

### References
- [Source: epics.md — Story 5.4]
- [Source: api/src/db/schema.ts — companies, analysisJobs, jobStatusEnum]
- [Source: api/src/common/filters/all-exceptions.filter.ts — error shape]
- [Source: api/src/jobs/jobs.service.ts — ensureCompany (AC3 overlap), ticker-validation.pipe.ts]

## Dev Agent Record
### Agent Model Used
claude-opus-4-7 (scaffold + implementation)
### Completion Notes List
- Endpoint scaffold (CompaniesModule + GET summary) confirmed correct against AC1/AC2/AC4; all dependencies verified (schema fields, AllExceptionsFilter error shape, AppModule registration).
- AC3 confirmed owned by 5.1's `JobsController`/`JobsService` — not duplicated.
- Task 3: `TickerValidationPipe` relocated `jobs/` → `common/`; both controllers updated; `companies → jobs` coupling removed.
- Task 4: service + controller specs added. `npx jest` (companies, common, jobs) 18/18 green; `nest build` clean; `eslint` 0 errors (only the project-standard `no-unsafe-argument` test-mock warnings).
### File List
- _bmad-output/implementation-artifacts/5-4-company-and-search-api-endpoints.md
- api/src/companies/companies.module.ts
- api/src/companies/companies.controller.ts (TickerValidationPipe import → common/)
- api/src/companies/companies.service.ts
- api/src/companies/companies.service.spec.ts (new)
- api/src/companies/companies.controller.spec.ts (new)
- api/src/companies/dto/company-summary.dto.ts
- api/src/common/ticker-validation.pipe.ts (moved from jobs/)
- api/src/common/ticker-validation.pipe.spec.ts (moved from jobs/)
- api/src/jobs/jobs.controller.ts (TickerValidationPipe import → common/)
- api/src/jobs/ticker-validation.pipe.ts (removed)
- api/src/jobs/ticker-validation.pipe.spec.ts (removed)
- api/src/app.module.ts (modified)

## Change Log
- 2026-05-27: Story drafted + module scaffolded by claude-opus-4-7.
- 2026-05-28: Implementation completed — pipe relocated to common/, service + controller specs added; story moved to review by claude-opus-4-7.
