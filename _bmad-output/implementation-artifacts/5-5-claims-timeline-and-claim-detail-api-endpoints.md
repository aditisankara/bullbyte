# Story 5.5: Claims Timeline & Claim Detail API Endpoints

Status: review

## Story

As a **developer**,
I want NestJS API endpoints that serve the full claims timeline and individual claim detail for a ticker,
So that the Angular frontend has all the structured data it needs to render the promise timeline and claim detail views.

## Acceptance Criteria

1. **Given** `GET /api/v1/companies/:ticker/claims`
   **When** claims exist for that ticker
   **Then** the response is `{ "data": [...], "meta": { "total": N, "page": 1, "pageSize": 20 } }` with up to 8 quarters of claims (FR31); each claim includes `id`, `quarter`, `rawQuote`, `speaker`, `metric`, `targetValue`, `targetUnit`, `extractionConfidence`, and a nested `verdict` object (or null if pending); `quarter` is always `"Q3-2024"` format

2. **Given** `GET /api/v1/claims/:claimId`
   **When** the claim exists
   **Then** the response includes full claim detail: `rawQuote`, `speaker`, `quarter`, `verdict` (with `verdictType`, `delta`, `confidenceScore`, `isCorrection`), `edgarSourceUrl`, and the ordered `reasoningTrace` array (FR36–FR39), served from PostgreSQL only — no FastAPI calls

3. **Given** a claim with `confidenceScore` below the low-confidence threshold
   **When** the claim detail endpoint responds
   **Then** the response includes top-level `"lowConfidence": true` (FR40) and the verdict is still returned — never withheld

4. **Given** the claims endpoint for a ticker with no claims yet
   **When** the response is returned
   **Then** it is `{ "data": [], "meta": { "total": 0, ... } }` with HTTP 200 — not a 404

## Tasks / Subtasks

- [x] Task 0: Close the `target_unit` persistence gap (AC1 prerequisite)
  - [x] `api/src/db/schema.ts`: nullable `targetUnit: text('target_unit')` on `claims`; migration `0003_powerful_viper.sql` generated via `npm run db:generate`
  - [x] `ml-sidecar/src/db/queries.py`: `target_unit` written in `insert_claim` + `insert_claim_batch` (resolves half the 4.1 TODO; `claim_type`/`timeframe` remain deferred)
  - [x] `ml-sidecar/src/routers/analysis_router.py`: `target_unit` included in `claim_dicts`
  - [x] ml-sidecar tests still green (187/187 in the dev container)

- [x] Task 1: `ClaimsModule` under `api/src/claims/` (AC1, AC2, AC4)
  - [x] `claims.controller.ts`: `GET companies/:ticker/claims` (TickerValidationPipe + `?page=` via DefaultValuePipe/ParseIntPipe) and `GET claims/:claimId` (ParseUUIDPipe)
  - [x] `claims.service.ts`: `listByTicker(ticker, page)` + `getDetail(claimId)`
  - [x] DTOs: `claim-list.dto.ts`, `claim-detail.dto.ts`, `claim-verdict.dto.ts`, all camelCase
  - [x] `claims.constants.ts`: `LOW_CONFIDENCE_THRESHOLD = 0.6` (parity with frontend `confidence-indicator`)
  - [x] Registered in `AppModule`

- [x] Task 2: List semantics (AC1, AC4)
  - [x] Unknown ticker → 404 `TICKER_NOT_FOUND` (consistent with 5.4); known ticker with zero claims → 200 empty payload
  - [x] 8-quarter window: claims restricted to the 8 most recent distinct quarters (`split_part` year::int desc, then quarter-label desc; GROUP BY so Postgres allows the expression ordering)
  - [x] Pagination: fixed `pageSize: 20`; `meta.total` counts claims inside the window
  - [x] Nested `verdict` = the latest verdicts row per claim (corrections are newer, so latest = effective); `PENDING` (or no row) → `verdict: null`

- [x] Task 3: Detail semantics (AC2, AC3)
  - [x] 404 `CLAIM_NOT_FOUND` with `details: { claimId }` when absent
  - [x] `verdict` = latest verdicts row (null when `PENDING`/absent); `reasoningTrace` = trace rows of that latest verdicts row ordered by `stepIndex` then `createdAt` (shown even when verdict is pending — the steps so far)
  - [x] `edgarSourceUrl` from `transcripts.filing_url` on `(ticker, quarter)`; null if not cached
  - [x] `lowConfidence` = verdict present ∧ `confidenceScore` non-null ∧ `< 0.6`; verdict always returned (AC3)

- [x] Task 4: Tests
  - [x] Service (11 specs): list happy path, pending → null verdict, correction-wins, empty → 200 not 404, unknown ticker → 404, pagination meta + page clamp, detail happy path (trace order, edgarSourceUrl), detail 404, lowConfidence below/at threshold, pending detail keeps trace
  - [x] Controller: delegation + param plumbing

- [x] Task 5: Verify — `npx jest` 77/77 green, `nest build` clean, `eslint` 0 errors; migration applied to the local dev DB and both endpoints smoke-tested live against seeded rows (then cleaned up)

## Dev Notes

### Data model (read-only consumers of 4.1–4.5 output)
- `claims` (4.1/4.2) — `quarter` already stored `"Q3-2024"`; `extraction_confidence numeric(4,3)` arrives as string from Drizzle → `parseFloat`
- `verdicts` (4.3/4.4) — append-only; `verdict_type ∈ {DELIVERED, MISSED, INSUFFICIENT_DATA, PENDING, REVISED}`; corrections carry `is_correction` + `corrects_verdict_id`; "current" verdict = newest `created_at`
- `reasoning_traces` (4.5) — FK to verdicts, ordered by `step_index`
- `transcripts` (3.2/3.7) — `(ticker, quarter)` unique, `filing_url` = EDGAR source

### Why this story touches ml-sidecar (Task 0)
AC1 requires `targetUnit`, but 4.1 deferred the column (TODO at `ml-sidecar/src/db/queries.py:53`) — the model extracts `target_unit` and then drops it at persist time. The additive nullable column + two INSERT updates close the gap end-to-end; existing rows serve `targetUnit: null`. Flag for Dev 1 review in the PR.

### The 404 error shape is automatic
Same as 5.4: `throw new NotFoundException({ code, details })` → `AllExceptionsFilter` emits the canonical envelope.

### No FastAPI calls
Everything is served from PostgreSQL via the global `DRIZZLE` token (AC2's "no additional calls to FastAPI" is structural — the module imports nothing from `MlSidecarService`).

### References
- [Source: epics.md — Story 5.5]
- [Source: api/src/db/schema.ts — claims, verdicts, reasoningTraces, transcripts]
- [Source: api/src/companies/* — module/controller/service/spec patterns from 5.4]
- [Source: ml-sidecar/src/db/queries.py — insert_claim TODO]
- [Source: frontend/src/app/shared/confidence-indicator — LOW_CONFIDENCE_THRESHOLD = 0.6]

## Dev Agent Record
### Agent Model Used
claude-opus-4-8 (story draft + implementation)
### Completion Notes List
- **Live smoke test caught a correctness bug the unit mocks could not:** verdicts written in the same transaction get identical `created_at` (Postgres `now()` is transaction time), so `ORDER BY created_at DESC LIMIT 1` non-deterministically returned the superseded original instead of its correction. Fixed semantically: the effective verdict is the newest row **not superseded by any correction** (`corrects_verdict_id` scan), with a regression spec for the tie case. Timestamp order alone is never trusted.
- Verified end-to-end against the running stack: seeded claim + PENDING verdict + same-transaction correction + out-of-order trace rows + transcript; both endpoints returned the correction (`isCorrection: true`), `lowConfidence: true` at 0.55, the trace re-ordered by `stepIndex`, and the transcript `filing_url` as `edgarSourceUrl`. Seed rows deleted afterwards.
- `target_unit` now flows end-to-end (extraction model → insert → API DTO); existing rows serve `targetUnit: null`. The 4.1 TODO now covers only `claim_type`/`timeframe`.
- Empty-claims AC4 also verified live: `{ data: [], meta: { total: 0, page: 1, pageSize: 20 } }` with HTTP 200.
### File List
- _bmad-output/implementation-artifacts/5-5-claims-timeline-and-claim-detail-api-endpoints.md
- api/src/db/schema.ts (claims.targetUnit)
- api/src/db/migrations/0003_powerful_viper.sql (+ meta journal/snapshot)
- api/src/claims/claims.module.ts (new)
- api/src/claims/claims.controller.ts (new)
- api/src/claims/claims.service.ts (new)
- api/src/claims/claims.constants.ts (new)
- api/src/claims/dto/claim-verdict.dto.ts (new)
- api/src/claims/dto/claim-list.dto.ts (new)
- api/src/claims/dto/claim-detail.dto.ts (new)
- api/src/claims/claims.service.spec.ts (new, 12 specs)
- api/src/claims/claims.controller.spec.ts (new, 2 specs)
- api/src/app.module.ts (ClaimsModule registration)
- ml-sidecar/src/db/queries.py (target_unit in claim inserts)
- ml-sidecar/src/routers/analysis_router.py (target_unit in claim_dicts)

## Change Log
- 2026-06-07: Story drafted; implementation completed — target_unit migration, ClaimsModule (list + detail), effective-verdict supersession fix from live smoke testing; 77/77 api + 187/187 ml green; moved to review.
