# Story 5.3: FastAPI → NestJS Webhook Progress Relay

Status: review

## Story

As a **developer**,
I want FastAPI to call a NestJS internal webhook after each agent step completes and NestJS to relay that event to the active SSE stream,
So that agent progress is surfaced to the frontend within 5 seconds of each step completing without shared memory or Redis pub/sub.

## Acceptance Criteria

1. **Given** the FastAPI ML sidecar completes an agent step
   **When** it calls `POST /internal/jobs/:jobId/progress`
   **Then** NestJS receives the payload and relays it to the active SSE stream for that `jobId` within 5s (NFR5)
   **And** the webhook is not reachable from outside the Docker network (NFR13, NFR14)

2. **Given** the webhook payload arrives at NestJS
   **When** NestJS relays it to the SSE stream
   **Then** the SSE event payload is identical to the webhook payload — no transformation
   **And** a structured log entry is emitted with `jobId`, `event`, `stepIndex`, `timestamp`

3. **Given** a webhook call arrives for a `jobId` with no active SSE client
   **Then** NestJS accepts it gracefully (no error to FastAPI)
   **And** FastAPI's analysis run continues uninterrupted

4. **Given** the FastAPI sidecar needs the NestJS webhook URL
   **Then** it reads `NESTJS_WEBHOOK_URL` from the environment — no hardcoded URLs (NFR12)

## Tasks / Subtasks

- [x] Task 1: Webhook body DTO `dto/progress-webhook.dto.ts` (AC2)
  - [x] class-validator mirror of `ProgressEvent` — reuses `SSE_EVENTS` / `ProgressEvent` from 5.2's `progress-event.dto.ts`; SP3 contract now locked across NestJS + FastAPI.
- [x] Task 2: `InternalWebhookController` (`internal-webhook.controller.ts`) (AC1, AC2, AC3)
  - [x] `@Controller('internal/jobs')` `@Post(':jobId/progress')` → 202; calls `ProgressService.publish()` (no-op when no listener → AC3).
  - [x] Rejects path/body `jobId` mismatch with 400 (validation, not transformation).
  - [x] Structured Winston log: `{ service, jobId, event, stepIndex, timestamp }`.
- [x] Task 3: `InternalWebhookGuard` (`common/guards/internal-webhook.guard.ts`) (AC1, NFR13/14)
  - [x] Constant-time check of `X-Internal-Token` against `INTERNAL_WEBHOOK_SECRET`; 401 on miss. The API's :3000 is host-published, so the secret — not the path — is what makes the webhook unreachable externally.
- [x] Task 4: Global-prefix exclusion (`main.ts`) + module wiring (`jobs.module.ts`) (AC4)
  - [x] `setGlobalPrefix('api/v1', { exclude: [internal/jobs/:jobId/progress] })` so the path is `/internal/...`, matching the committed `NESTJS_WEBHOOK_URL`.
- [x] Task 5: Config + env
  - [x] `INTERNAL_WEBHOOK_SECRET` added to Joi schema + `.env.example` (+ local `.env`).
- [x] Task 6: FastAPI caller helper (AC2, AC3, AC4)
  - [x] `models/progress_models.py` — Pydantic `ProgressEvent` with camelCase aliases (wire shape identical to the NestJS DTO).
  - [x] `core/progress_webhook.py` — `emit_progress()`: reads `NESTJS_WEBHOOK_URL` + secret from env, POSTs via httpx, swallows+logs transport errors (AC3).
- [x] Task 7: Tests
  - [x] `internal-webhook.controller.spec.ts`: verbatim publish (AC2), structured log (AC2), path/body mismatch → 400.
  - [x] `internal-webhook.guard.spec.ts`: correct token allow; wrong/missing → 401.
  - [x] `test_progress_webhook.py`: correct URL + `X-Internal-Token` + camelCase body; transport error swallowed; missing URL is a no-op.

## Dev Notes

### What This Story Builds
The webhook half of the progress pipeline: a guarded NestJS receiver that relays to 5.2's `ProgressService.publish()` seam, plus a reusable FastAPI `emit_progress()` client. It closes the loop 5.2 left open (`publish()` previously had no caller).

### Boundary with 5.2 (SP3 — now resolved)
5.2 owned the SSE shape + `publish()`; 5.3 owns the `POST /internal/jobs/:jobId/progress` receiver + the FastAPI emitter. The SSE payload and webhook payload are identical: the NestJS DTO and the FastAPI Pydantic model share the same camelCase fields + kebab-case event names + ISO8601 timestamp. SP3 sign-off is satisfied by these two committed contract definitions.

### Security (NFR13/NFR14)
Shared-secret header (`X-Internal-Token`). The API's :3000 is published to the host, so a `/internal` path namespace alone cannot make the webhook unreachable externally — the secret does. IP/subnet filtering was rejected (Docker SNAT makes host-published traffic appear to come from a private gateway IP, so it cannot reliably distinguish external callers).

### Out of Scope
`emit_progress()` is not yet wired into a live agent pipeline — none exists (`/analyze/{ticker}` is still a stub; Epic 4 is backlog). The helper is ready for whoever builds the orchestrator.

### References
- [Source: epics.md — Story 5.3]
- [Source: architecture.md — Real-time progress: FastAPI POST /internal webhook → NestJS SSE relay]
- [Source: api/src/jobs/progress.service.ts — ProgressService.publish() (5.2)]
- [Source: api/src/jobs/dto/progress-event.dto.ts — shared SSE/webhook contract]

## Dev Agent Record
### Agent Model Used
claude-opus-4-8 (implementation)
### Completion Notes List
- NestJS receiver + guard + FastAPI client complete; SP3 contract locked by the shared DTO + Pydantic model.
- `npx jest` green (65 tests incl. 6 new); `nest build` clean; eslint 0 errors on 5.3 files (only the project-standard `no-unsafe-argument` test-mock warnings). `uv run pytest` green (129 tests incl. 3 new).
- End-to-end verified against the running stack: 401 without token; 404 at `/api/v1/internal/...` (prefix exclusion); 202 + verbatim SSE frame on a live relay; 400 on jobId mismatch; structured log line confirmed.
- Pre-existing, unrelated: `src/db/schema.ts` shows local prettier/CRLF lint errors on this Windows checkout (LF on CI) — not touched by this story.
### File List
- _bmad-output/implementation-artifacts/5-3-fastapi-to-nestjs-webhook-progress-relay.md (new)
- api/src/jobs/dto/progress-webhook.dto.ts (new)
- api/src/jobs/internal-webhook.controller.ts (new)
- api/src/jobs/internal-webhook.controller.spec.ts (new)
- api/src/common/guards/internal-webhook.guard.ts (new)
- api/src/common/guards/internal-webhook.guard.spec.ts (new)
- api/src/jobs/jobs.module.ts (modified)
- api/src/main.ts (modified)
- api/src/config/app.config.ts (modified)
- ml-sidecar/src/models/progress_models.py (new)
- ml-sidecar/src/core/progress_webhook.py (new)
- ml-sidecar/tests/test_progress_webhook.py (new)
- .env.example (modified)

## Change Log
- 2026-05-29: Story implemented (NestJS webhook receiver + guard + FastAPI client) and verified end-to-end; moved to review by claude-opus-4-8.
