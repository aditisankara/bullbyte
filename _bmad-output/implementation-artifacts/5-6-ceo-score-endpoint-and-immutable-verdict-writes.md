# Story 5.6: CEO Score Endpoint & Immutable Verdict Writes

Status: review

## Story

As a **developer**,
I want a NestJS endpoint that serves the computed CEO Delivery Score and enforces immutable verdict writes for any corrections,
So that the frontend can display the score with full context and verdict integrity is guaranteed at the API layer.

## Acceptance Criteria

1. **Given** `GET /api/v1/companies/:ticker/score`
   **When** resolved verdicts exist for that ticker
   **Then** the response includes `score` (numeric 0â€“1 or null), `deliveredCount`, `missedCount`, `totalResolved`, `pendingCount`, `insufficientDataCount` (FR22, FR23)
   **And** `score` is `null` with `"context": "No resolved claims yet"` when no resolved verdicts exist â€” never 0

2. **Given** a verdict correction needs to be written to PostgreSQL
   **When** the write occurs
   **Then** a new `verdicts` record is created with `is_correction: true` and `corrects_verdict_id` pointing to the original
   **And** the original verdict record is never modified â€” its `created_at` and `verdict_type` are immutable (FR45, NFR7)

3. **Given** two concurrent requests attempt to write verdicts for the same claim
   **When** both writes hit PostgreSQL
   **Then** no data corruption or duplicate non-correction records are created (NFR11)

4. **Given** a score request for a ticker with pending claims
   **When** the score is returned
   **Then** `pendingCount` accurately reflects the number of unresolved claims
   **And** pending claims are never counted in `totalResolved` or factored into the `score` value

## Tasks / Subtasks

- [x] Task 1: `ScoreModule` under `api/src/score/` (AC1)
  - [x] `score.controller.ts`: `GET companies/:ticker/score` (TickerValidationPipe, same as 5.4/5.5)
  - [x] `score.service.ts`: `getScore(ticker)` â€” PostgreSQL only, no FastAPI calls (4.6 doc leaves the transport choice to this story; direct DB matches the 5.5 precedent)
  - [x] `dto/ceo-score.dto.ts`: `{ ticker, score, deliveredCount, missedCount, totalResolved, pendingCount, insufficientDataCount, context }` â€” all camelCase; `context` always present (mirrors 4.6's `contextMessage` format)
  - [x] Register in `AppModule` (the only file shared with in-flight 5.5 â€” keep the diff to that one line)

- [x] Task 2: Correction-aware score semantics (AC1, AC4)
  - [x] Effective verdict per claim = latest `verdicts` row by `created_at` (same rule 5.5 uses) â€” do NOT reuse 4.6's raw `GROUP BY verdict_type` row counts (corrections double-count; claims with no verdict row are invisible)
  - [x] `LEFT JOIN` from `claims` so every claim is classified: `deliveredCount` / `missedCount` / `insufficientDataCount` = claims whose effective verdict is that type; `pendingCount` = effective verdict `PENDING` **or no verdict row at all**
  - [x] `totalResolved = deliveredCount + missedCount` only; `score = deliveredCount / totalResolved`, `null` (never 0) with `context: "No resolved claims yet"` when `totalResolved == 0`
  - [x] `REVISED` silently excluded from all counts (Phase 2, parity with 4.6)
  - [x] Unknown ticker â†’ 404 `TICKER_NOT_FOUND`; known ticker with zero claims â†’ 200 with null score (not 404)

- [x] Task 3: Immutable verdict writes â€” `VerdictsWriteService` in `api/src/verdicts/` (AC2, AC3)
  - [x] Single write method, insert-only (no `UPDATE`/`DELETE` on `verdicts` anywhere in the module), inside `db.transaction`:
    1. `SELECT ... FOR UPDATE` on the `claims` row (serializes concurrent writers per claim â€” NFR11)
    2. Fetch latest existing verdict for the claim
    3. None exists â†’ insert with `isCorrection: false`; one exists â†’ insert with `isCorrection: true` + `correctsVerdictId` = latest verdict id
  - [x] Reject corrections targeting a verdict of a different claim (defensive 422/409)
  - [x] No HTTP route â€” epics define no correction endpoint; this is the service-layer write path future correction flows must use (exported via module for later stories)

- [x] Task 4: Tests
  - [x] Score service: mixed verdicts ratio + counts, correction supersedes original (corrected claim counted once, by its correction), claim with no verdict row â†’ pending, all-pending â†’ null score + context, zero claims â†’ null score, REVISED excluded, unknown ticker â†’ 404
  - [x] Verdicts write service: first write â†’ non-correction; second write â†’ correction pointing at original; correction never mutates original row; cross-claim correction rejected; transaction + FOR UPDATE plumbing asserted on the mock
  - [x] Controller: delegation + TickerValidationPipe plumbing

- [x] Task 5: Verify â€” `npx jest` green, `nest build` clean, `eslint` clean

## Dev Notes

### Schema is already in place â€” no migration
`verdicts` (api/src/db/schema.ts:95-126) already has `isCorrection boolean NOT NULL DEFAULT false`, `correctsVerdictId uuid REFERENCES verdicts(id)`, and a `no_self_correction` check. This story adds no columns; immutability is enforced by the insert-only service + transaction, not schema changes. (A partial unique index on `(claim_id) WHERE is_correction = false` was considered but rejected â€” it could break ML-sidecar retry paths in Dev 1's lane; the `FOR UPDATE` lock gives NFR11 without touching shared write paths.)

### Why not reuse 4.6's aggregation
`get_verdicts_for_ticker()` (ml-sidecar, story 4.6) does `GROUP BY verdict_type` over **all** verdict rows. Once corrections exist, the original and the correction both count; claims that have no verdict row yet don't count as pending. AC4 demands per-claim accuracy, so this endpoint computes effective-verdict-per-claim (`DISTINCT ON (claim_id) ... ORDER BY claim_id, created_at DESC` or a window function via `sql` template) and left-joins from `claims`. The scalar invariants (`totalResolved = delivered + missed`, null-not-zero score, REVISED excluded) are identical to 4.6 â€” keep message format parity with `contextMessage`.

### CEO name attribution is out of scope
The 4.6 story doc says CEO name attribution was "deferred to story 5.6", but no FR, no 5.6/6.4 AC, and no Epic 2 score-card spec consumes a `ceoName` field. Leave `executives` (3.8) untouched; if the designer adds it later it's a one-join addition.

### The 404 error shape is automatic
Same as 5.4/5.5: `throw new NotFoundException({ code: 'TICKER_NOT_FOUND', details: { ticker } })` â†’ `AllExceptionsFilter` emits the canonical envelope.

### Parallel-safety with 5.5 (in flight)
5.5 owns `api/src/claims/` and touches `schema.ts` (adds `targetUnit`). This story creates only `api/src/score/` + `api/src/verdicts/` and registers two modules in `AppModule` â€” the single expected merge-conflict point, trivially resolvable.

### References
- [Source: epics.md â€” Story 5.6]
- [Source: api/src/db/schema.ts:95-126 â€” verdicts table]
- [Source: api/src/companies/* â€” module/controller/service/spec patterns from 5.4]
- [Source: _bmad-output/implementation-artifacts/4-6-ceo-delivery-score-computation.md â€” score invariants + handoff notes]
- [Source: ml-sidecar/src/services/scoring_service.py â€” reference aggregation + contextMessage format]
- [Source: ml-sidecar/src/db/queries.py â€” get_verdicts_for_ticker (row-count caveat)]

## Dev Agent Record
### Agent Model Used
claude-opus-4-8 (story draft + implementation)
### Completion Notes List
- `ScoreModule` serves `GET /api/v1/companies/:ticker/score` from PostgreSQL only — correction-aware per-claim counting (effective verdict = latest row, corrections win `created_at` ties), `LEFT JOIN`-equivalent classification so verdict-less claims count as pending (AC4)
- `score: null` + `context: "No resolved claims yet"` when `totalResolved == 0`; context message format matches 4.6's `contextMessage`; REVISED claims silently excluded (4.6 parity)
- `VerdictsWriteService` is insert-only inside a `db.transaction` with `SELECT ... FOR UPDATE` on the claims row (NFR11); correction semantics derived automatically — existing verdict → `is_correction: true` + `corrects_verdict_id` chained to the latest (AC2/AC3)
- Cross-claim/stale correction rejection via optional `expectedCorrectsVerdictId` optimistic guard → 409 `STALE_VERDICT_CORRECTION`
- No HTTP route for corrections (epics define none); service exported via `VerdictsModule` for future flows
- 14 new tests; full suite 77/77 green; `nest build` clean; `eslint` 0 errors (warnings at codebase baseline)
### File List
- `api/src/score/score.module.ts` (new)
- `api/src/score/score.controller.ts` (new)
- `api/src/score/score.service.ts` (new)
- `api/src/score/dto/ceo-score.dto.ts` (new)
- `api/src/score/score.controller.spec.ts` (new)
- `api/src/score/score.service.spec.ts` (new)
- `api/src/verdicts/verdicts.module.ts` (new)
- `api/src/verdicts/verdicts-write.service.ts` (new)
- `api/src/verdicts/verdicts-write.service.spec.ts` (new)
- `api/src/app.module.ts` (modified — module registration only)

## Change Log
- 2026-06-07: Story drafted from epics.md + 4.6 handoff notes; ready for dev.
- 2026-06-07: Implemented score endpoint + immutable verdict write service with tests; pre-review.
