# Story 5.2: SSE Progress Stream Endpoint

Status: ready-for-dev

## Story

As a **developer**,
I want a Server-Sent Events endpoint in NestJS that streams real-time agent step progress to the client for a given job,
So that the Angular frontend can display a live step-by-step feed while a fresh ticker is being analysed.

## Acceptance Criteria

1. **Given** `GET /api/v1/jobs/:jobId/progress` with `Accept: text/event-stream`
   **When** the connection is established
   **Then** NestJS keeps it open and streams events as they arrive (FR34), `Content-Type: text/event-stream` with no-cache headers

2. **Given** an SSE event is emitted
   **Then** the payload matches `{ event, jobId, stepIndex, totalSteps, message, timestamp }`
   **And** `event` is one of the kebab-case canonical names: `analysis-started`, `transcript-fetched`, `claims-extracted`, `claim-verified`, `analysis-complete`, `analysis-failed`

3. **Given** the job reaches a terminal state (`COMPLETED`/`FAILED`)
   **Then** NestJS emits the terminal event and closes the connection cleanly — no further events

4. **Given** a client connects to a `jobId` that is already `COMPLETED`
   **Then** NestJS immediately emits `analysis-complete` and closes — the client is not left waiting (NFR5)

5. **Given** multiple clients connect to the same `jobId`
   **Then** all receive every event with no corruption or missed events (NFR11)

## Tasks / Subtasks

- [ ] Task 1: Canonical payload `dto/progress-event.dto.ts` (AC2)
  - [ ] `ProgressEvent` interface + `SSE_EVENTS` (kebab-case) union + `TERMINAL_EVENTS`
  - [ ] **SP3:** this shape is the shared contract with FastAPI — lock it with Dev 1 before 5.3 codes against it

- [ ] Task 2: `ProgressService` (`progress.service.ts`) (AC3, AC4, AC5)
  - [ ] One multicast `Subject<ProgressEvent>` per active `jobId` (Map) → all clients for a job share it (AC5)
  - [ ] `publish(event)` — push to the job's subject; complete + drop on a terminal event (AC3). Called by the 5.3 webhook relay
  - [ ] `stream(jobId)` — if the job is already terminal in the DB, emit the terminal event once and close (AC4); else stream live until terminal

- [ ] Task 3: `JobsProgressController` (`jobs-progress.controller.ts`) (AC1)
  - [ ] `@Sse(':jobId/progress')` on `@Controller('jobs')` → `/api/v1/jobs/:jobId/progress`, returns `Observable<MessageEvent>`
  - [ ] NestJS `@Sse()` sets the `text/event-stream` + no-cache headers automatically

- [ ] Task 4: Register in `JobsModule`
  - [ ] Add `JobsProgressController` + `ProgressService`; **export `ProgressService`** so the 5.3 webhook module can call `publish()`

- [ ] Task 5: Tests
  - [ ] `progress.service.spec.ts`: `publish` fans out to all subscribers (AC5); terminal event completes the stream (AC3); already-terminal job emits once + completes (AC4)
  - [ ] (e2e) optional: connect with `Accept: text/event-stream`, assert headers + an event frame

## Dev Notes

### What This Story Builds
The SSE transport + an in-process `ProgressService.publish()` seam. It does **not** build the FastAPI webhook receiver — that's 5.3, which will call `publish()`. Without 5.3, only the already-terminal path (AC4) and unit-level fan-out are exercisable end-to-end.

### Boundary with 5.3 (SP3)
5.2 owns the SSE shape + `publish()`; 5.3 owns the `POST /internal/jobs/:jobId/progress` receiver that calls `publish()`. The SSE payload here and the webhook payload in 5.3 **must be identical** — agree the JSON (fields + kebab-case event names + ISO8601 timestamp) with Dev 1 first.

### Why a Subject-per-job
A shared `Subject` is multicast: every SSE subscriber for a `jobId` receives `next()` events → satisfies AC5 with no extra plumbing. Complete the subject on a terminal event so all connections close (AC3).

### Already-terminal short-circuit (AC4)
`jobId` is the `analysis_jobs.id`. On connect, read its status; if `COMPLETED`/`FAILED`, emit the matching terminal event and complete the Observable immediately. Inject the global `DRIZZLE` token.

### MessageEvent
NestJS `@Sse()` expects `Observable<MessageEvent>` (`{ data, type?, id?, retry? }` from `@nestjs/common`). Put the `ProgressEvent` in `data` and set `type` to the event name.

### References
- [Source: epics.md — Story 5.2]
- [Source: architecture.md — Real-time progress: SSE from NestJS, native EventSource]
- [Source: dev-plan.md — SP3 webhook contract]
- [Source: api/src/db/schema.ts — analysisJobs (status by id)]

## Dev Agent Record
### Agent Model Used
(scaffold authored by claude-opus-4-7; implementation TBD)
### Completion Notes List
- Scaffold only: SSE controller + ProgressService (publish/stream) created; tests (Task 5) pending; 5.3 webhook will drive publish().
### File List
- _bmad-output/implementation-artifacts/5-2-sse-progress-stream-endpoint.md
- api/src/jobs/dto/progress-event.dto.ts
- api/src/jobs/progress.service.ts
- api/src/jobs/jobs-progress.controller.ts
- api/src/jobs/jobs.module.ts (modified)

## Change Log
- 2026-05-27: Story drafted + SSE module scaffolded by claude-opus-4-7.
