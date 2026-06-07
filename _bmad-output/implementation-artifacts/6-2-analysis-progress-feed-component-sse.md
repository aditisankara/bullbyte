# Story 6.2: Analysis Progress Feed Component (SSE)

Status: review

## Story

As a **retail investor**,
I want to see a live step-by-step feed of what BullByte is doing while it analyses a ticker for the first time,
So that I understand what's happening during the wait and feel confident the system is working rather than broken.

## Acceptance Criteria

1. **Given** a fresh ticker analysis is triggered (job status `QUEUED` or `RUNNING`)
   **When** the company page renders
   **Then** the `AnalysisProgressComponent` opens an `EventSource` connection to `GET /api/v1/jobs/:jobId/progress` (FR34), and each SSE event appends a new step message to the feed within 5 seconds of the agent step completing (NFR5)

2. **Given** an SSE event is received
   **When** the progress feed updates
   **Then** the step message text is displayed matching the Epic 2 Progress Feed spec, completed steps are visually distinguished from the in-progress step (UX-DR1), and the feed never shows a blank or skeleton state between steps

3. **Given** the `analysis-complete` SSE event is received
   **When** the event is processed
   **Then** the `EventSource` connection is closed, and the component automatically fetches `GET /api/v1/companies/:ticker` and re-renders the timeline, score, and claims without a manual page refresh

4. **Given** the `analysis-failed` SSE event is received
   **When** the event is processed
   **Then** the progress feed renders the analysis-failed error state matching the Epic 2 Error State spec (UX-DR6), and a retry action triggers a new `POST /api/v1/companies/:ticker/analyze`

5. **Given** the user navigates away while an SSE stream is open
   **When** the Angular component is destroyed
   **Then** the `EventSource` connection is closed cleanly — no memory leaks or dangling connections

## Tasks / Subtasks

- [x] Task 1: Expose `latestJobId` on the company summary (AC1 pre-req)
  - [x] `api/src/companies/dto/company-summary.dto.ts` — add `latestJobId: string | null`. The company page needs a jobId to open the SSE stream on a direct/bookmarked load mid-analysis; today the summary carries only `jobStatus` and the search page discards the jobId from `POST /analyze`
  - [x] `companies.service.ts` — the latest-job query already runs; select `id` alongside `status`
  - [x] Update `companies.service.spec.ts` / `companies.controller.spec.ts` expectations
  - [x] Mirror in `frontend/src/app/core/api/company.models.ts` (`CompanySummary.latestJobId`)
  - [x] **Additive only** — `api/src/app.module.ts`, `db/schema.ts`, and 5.5's in-flight file set untouched

- [x] Task 2: `ProgressStreamService` — typed EventSource wrapper (AC1, AC3, AC5)
  - [x] `core/api/progress-stream.service.ts` — `connect(jobId): Observable<ProgressEvent>` against `${environment.apiBaseUrl}/jobs/:jobId/progress`
  - [x] The server sets a `type` on every frame (named events), so `onmessage` never fires — `addEventListener` for each of the six `SSE_EVENTS` names from `shared/analysis/progress-event.ts`; JSON-parse `event.data`
  - [x] **Close the `EventSource` client-side on a terminal event** — the browser auto-reconnects when the server ends the stream, and 5.2's already-terminal snapshot would re-emit `analysis-complete` forever (reconnect loop)
  - [x] Complete the Observable after the terminal event; close the `EventSource` on unsubscribe (teardown ⇒ AC5 is structural)
  - [x] Inject an `EVENT_SOURCE_FACTORY` token (default `(url) => new EventSource(url)`) so specs substitute a fake — same seam pattern as 6.1's interceptor-backed specs
  - [x] Spec with a fake EventSource: named-event dispatch → typed `ProgressEvent`, terminal event → `close()` called + complete, unsubscribe → `close()` called

- [x] Task 3: `AnalysisProgressComponent` — the smart feed (AC1–AC4)
  - [x] `features/company/analysis-progress.component.ts` — inputs `jobId`, `ticker`; output `completed` (parent refetches the summary)
  - [x] Accumulate received events in an append-only signal array; render the existing presentational `app-analysis-progress-feed` (2.3) — it already handles UX-DR1 glyphs and the trailing in-progress row
  - [x] Never-blank (AC2): opt-in `pending` input added to `AnalysisProgressFeedComponent` — shows an in-progress row ("Starting analysis…") before the first event, default off so 2.3 behaviour is unchanged (same opt-in pattern as 6.1's `autofocus`/`errorKind`)
  - [x] On `analysis-complete` → emit `completed` (AC3); on `analysis-failed` → render `app-error-state` (AC4) with a retry that calls `CompanyApiService.analyze(ticker)`, swaps to the returned `jobId`, resets the event list, and reconnects; a `cached: true` response (`jobId: null`) emits `completed` directly
  - [x] Stream subscription lives in an `effect` with `onCleanup` — destroy ⇒ unsubscribe ⇒ `EventSource.close()` (AC5)
  - [x] Spec: events append in order, complete → connection closed + `completed` emitted, failed → error state + retry re-analyzes and reconnects, cache-hit retry → direct `completed`, destroy → closed

- [x] Task 4: Wire into the company page (AC1, AC3)
  - [x] `features/company/company.component.ts` — `liveJobId` computed (non-null while `jobStatus` is `QUEUED`/`RUNNING`); renders `<app-analysis-progress>` in place of the placeholder grid; `(completed)` → `load()` refetches the summary and re-renders the layout (6.3–6.6 slots fill it later)
  - [x] Spec: RUNNING summary renders the feed (and opens the job's stream) with no layout; `analysis-complete` triggers a summary refetch and the dashboard returns

- [x] Task 5: Verify — frontend `ng test` 100/100 green, `ng lint` clean, `ng build` clean; api `jest` 63/63 green, `nest build` clean, eslint 0 errors; no API files outside the Task 1 set touched

## Dev Notes

### SSE contract (from 5.2/5.3 — do not re-shape)
- `GET /api/v1/jobs/:jobId/progress` streams NestJS `MessageEvent`s with `type` = event name and `data` = `ProgressEvent { event, jobId, stepIndex, totalSteps, message, timestamp }`.
- Event names (kebab-case, locked with FastAPI — SP3): `analysis-started`, `transcript-fetched`, `claims-extracted`, `claim-verified`, `analysis-complete`, `analysis-failed`. Terminal: the last two.
- The frontend mirror already exists at `frontend/src/app/shared/analysis/progress-event.ts` (`SSE_EVENTS`, `TERMINAL_EVENTS`, `isTerminal`, `statusForEvent`) — import it, never redeclare.
- Already-terminal short-circuit (5.2 AC4): connecting to a `COMPLETED`/`FAILED` job emits one terminal event and ends — so a stale `latestJobId` degrades gracefully into an immediate `completed`/failed state.

### EventSource gotchas (the heart of this story)
- **Named events**: server frames carry `event:` lines, so only `addEventListener('<name>', …)` fires — `onmessage` stays silent. Register all six.
- **Auto-reconnect**: `EventSource` reconnects whenever the connection drops, including after the server completes the stream. Client-side `close()` on terminal events is mandatory or the terminal snapshot loops. Mid-run drops, by contrast, *benefit* from auto-reconnect (5.2's subject-per-job re-attaches) — don't disable it, just close on terminal.
- Angular 21 here is zoneless — EventSource callbacks trigger no change detection by themselves; all updates flow through signals (`events.update(...)`) so OnPush re-renders.

### What already existed (not rebuilt)
- Presentational feed: `shared/analysis-progress-feed/analysis-progress-feed.component.ts` (2.3) — append-only rows, completed/failed glyphs, pulsing in-progress dot, `role="log"` aria-live. This story only adds the opt-in `pending` input.
- Error states: `shared/error-state/error-state.component.ts` (UX-DR6). AC4 uses the canonical `analysis-timeout` kind — the Epic 2 failure state with the "Re-run analysis" action — with `heading`/`body` overridden ("Analysis failed") since the run failed rather than timed out.
- Company page + 4-state `LoadState` union, `CompanyApiService.analyze/getSummary` (6.1).

### What this story does NOT do
- No timeline/score/claims rendering — 6.3–6.6 own the data panels; AC3's "re-renders" means refetching the summary so the existing layout re-renders with fresh state.
- No reasoning-trace feed — that is the per-claim trace (2.5/6.5), not this live run feed.
- No new SSE event names or payload fields (SP3 contract is locked).

### References
- [Source: epics.md — Story 6.2]
- [Source: api/src/jobs/jobs-progress.controller.ts; api/src/jobs/progress.service.ts — 5.2]
- [Source: api/src/jobs/dto/progress-event.dto.ts — SP3 contract]
- [Source: frontend/src/app/shared/analysis/progress-event.ts — frontend mirror]
- [Source: frontend/src/app/shared/analysis-progress-feed/analysis-progress-feed.component.ts — 2.3 spec]
- [Source: frontend/src/app/features/company/company.component.ts — 6.1 integration point]

## Dev Agent Record
### Agent Model Used
claude-opus-4-8 (story draft + implementation)
### Completion Notes List
- Developed in an isolated git worktree branched off `origin/main` (e02d076) while 5.5 was in flight in the primary clone — zero file overlap with 5.5's working set, one PR per story preserved.
- `ProgressStreamService.connect()` closes the EventSource *before* completing the Observable on a terminal event, so the unsubscribe teardown's `close()` is a no-op rather than a double-close; unsubscribe-closes makes AC5 structural for any consumer.
- The smart component's stream subscription lives in an `effect((onCleanup) ⇒ …)` keyed on the active jobId plus a retry counter — a retry that yields the *same* jobId still forces a clean reconnect, and component destroy runs the same cleanup path (AC5 verified by spec).
- Retry failure (`POST /analyze` itself erroring) renders distinct "Retry failed" copy via the error-state `heading`/`body` overrides instead of silently re-showing the original failure.
- `latestJobId` exposed on `CompanySummaryDto` (additive): the latest-job query in `CompaniesService.getSummary` already ran; it now selects `id` too. Without it the feed could not survive a direct/bookmarked load mid-analysis (AC1's "when the company page renders").
- Company page specs drive a fake `EVENT_SOURCE_FACTORY` through the real `httpErrorInterceptor` pipeline; the shared `FakeEventSource` test double lives in `core/api/testing/` and is reused by all three new spec files.
- Suites: frontend 100/100 (86 inherited + 14 new), lint clean, production build clean; api 63/63, `nest build` clean, eslint 0 errors (only the project-standard `no-unsafe-argument` test-mock warnings).
### File List
- _bmad-output/implementation-artifacts/6-2-analysis-progress-feed-component-sse.md
- api/src/companies/dto/company-summary.dto.ts (latestJobId)
- api/src/companies/companies.service.ts (select job id)
- api/src/companies/companies.service.spec.ts (expectations)
- api/src/companies/companies.controller.spec.ts (fixture)
- frontend/src/app/core/api/company.models.ts (latestJobId mirror)
- frontend/src/app/core/api/company-api.service.spec.ts (fixture)
- frontend/src/app/core/api/progress-stream.service.ts (new)
- frontend/src/app/core/api/progress-stream.service.spec.ts (new)
- frontend/src/app/core/api/testing/fake-event-source.ts (new, shared test double)
- frontend/src/app/features/company/analysis-progress.component.ts (new)
- frontend/src/app/features/company/analysis-progress.component.spec.ts (new)
- frontend/src/app/features/company/company.component.ts (live-run wiring)
- frontend/src/app/features/company/company.component.spec.ts (2 new specs + fixture)
- frontend/src/app/shared/analysis-progress-feed/analysis-progress-feed.component.ts (opt-in pending input)
- frontend/src/app/shared/analysis-progress-feed/analysis-progress-feed.component.spec.ts (1 new spec)

## Change Log
- 2026-06-07: Story drafted from epics.md §6.2; implementation deferred until the 5.5 working tree clears. Status: ready-for-dev.
- 2026-06-07: Implemented in an isolated worktree off origin/main — SSE stream service, smart progress component, company-page wiring, `latestJobId` on the summary DTO. Frontend 100/100, api 63/63, lint/build clean. Status: review.
