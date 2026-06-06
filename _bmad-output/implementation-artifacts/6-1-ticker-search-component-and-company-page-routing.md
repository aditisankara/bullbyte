# Story 6.1: Ticker Search Component & Company Page Routing

Status: review

## Story

As a **retail investor**,
I want to type a stock ticker into a search box and be taken directly to that company's promise dashboard,
So that I can access BullByte's analysis in seconds without creating an account or learning any navigation.

## Acceptance Criteria

1. **Given** a user navigates to `/`
   **When** the search page renders
   **Then** a prominent search input is displayed matching the Epic 2 Search Page spec, the page loads within 2 seconds on broadband (NFR3), and the input receives focus automatically

2. **Given** a user types a valid ticker (e.g. `TSLA`) and submits
   **When** the search is triggered
   **Then** the frontend calls `POST /api/v1/companies/:ticker/analyze` then navigates to `/company/TSLA` (FR28, FR29), with the search state moving through the 4-state union `"idle" → "loading" → "success" | "error"` — never a boolean `isLoading`

3. **Given** the ticker does not exist in the system
   **When** the API returns HTTP 404
   **Then** the search renders the ticker-not-found error state matching the Epic 2 Error State spec (UX-DR6), and no raw API error message or code is shown

4. **Given** a user navigates directly to `/company/TSLA`
   **When** the company page loads
   **Then** the app fetches `GET /api/v1/companies/TSLA` and renders the company dashboard without requiring a search first (FR29), and the URL is stable and bookmarkable

5. **Given** any page in the application
   **When** it is rendered
   **Then** the disclaimer footer is visible in a semantic `<footer>` (FR44, NFR20) and the heading hierarchy is correct — one `<h1>` per page

## Tasks / Subtasks

- [x] Task 1: Typed API client for the company endpoints (AC2, AC4)
  - [x] `core/api/company.models.ts` — frontend mirrors of `CompanySummaryDto`, `AnalyzeResponseDto`, the canonical `JobStatus` union, and the shared 4-state `LoadState` union
  - [x] `core/api/company-api.service.ts` — `analyze(ticker)` POST + `getSummary(ticker)` GET against `environment.apiBaseUrl`
  - [x] Service spec with `HttpTestingController`

- [x] Task 2: SearchInput wiring hooks (AC1, AC3)
  - [x] Add `autofocus` input to `SearchInputComponent` (focus after first render) — AC1's "receives focus automatically"
  - [x] Add `errorKind` input (default `'ticker-not-found'`) so non-404 failures can render `edgar-unavailable` instead of a misleading not-found message

- [x] Task 3: Search page (AC1–AC3)
  - [x] `features/search/search.component.ts` — hero layout (one `<h1>`), `app-search-input` with the 4-state union driven by a signal
  - [x] On submit: `state → loading`, `POST /analyze`; on 200/202 `state → success` then `router.navigate(['/company', ticker])`; on 400/404 `state → error` with ticker-not-found; on network/5xx `state → error` with edgar-unavailable
  - [x] Spec: renders + autofocus, analyze→navigate happy path, 404 → error state, no raw API error text

- [x] Task 4: Company page (AC4, AC5)
  - [x] `withComponentInputBinding()` in `app.config.ts`; `ticker` route param bound as a signal input
  - [x] `features/company/company.component.ts` — fetch `GET /companies/:ticker` on ticker change, 4-state union, render company header (`<h1>` = company name) + `CompanyPageLayout` shell with pending placeholders for score/timeline/claims/detail (filled by 6.2–6.6)
  - [x] 404 → ticker-not-found error state; other failures → edgar-unavailable with retry
  - [x] Spec: fetches on load (bookmarkable), renders name + ticker, 404 error state, single `<h1>`

- [x] Task 5: Verify — `ng test` green (86/86), `ng lint` clean, `ng build` clean (71 kB initial transfer — NFR3 headroom), heading/footer semantics intact

## Dev Notes

### API contract (from 5.1 + 5.4 — do not re-shape)
- `POST /api/v1/companies/:ticker/analyze` → `202 { jobId, status: 'QUEUED' }` or `200 { jobId: null, status: 'COMPLETED', cached: true }`. It **creates** the company if absent, so it never 404s; an invalid ticker format is a `400 INVALID_TICKER`.
- `GET /api/v1/companies/:ticker` → `200 CompanySummaryDto { id, ticker, name, lastAnalysedAt, jobStatus }` or `404 TICKER_NOT_FOUND`.
- `JobStatus` = `QUEUED | RUNNING | COMPLETED | FAILED` (locked Drizzle enum — mirror, never invent values).

### Error mapping
The `httpErrorInterceptor` (1.5) already strips raw API bodies into `ApiError { status, message }` — AC3's "no raw API error" is structural. Map `status 400|404` → `ticker-not-found`, anything else → `edgar-unavailable`.

### What this story does NOT do
- No SSE / progress feed — 6.2 owns `jobStatus QUEUED|RUNNING` liveness.
- No timeline/score/claims data — 6.3–6.6 fill the layout slots; this story renders the labelled pending placeholders inside `CompanyPageLayout`.
- No auth, no PII (FR30, NFR15).

### References
- [Source: epics.md — Story 6.1]
- [Source: api/src/jobs/dto/analyze-response.dto.ts; api/src/companies/dto/company-summary.dto.ts]
- [Source: frontend/src/app/shared/search-input/search-input.component.ts — 2.3 spec]
- [Source: frontend/src/app/shared/company-page-layout/company-page-layout.component.ts — 2.6 spec]

## Dev Agent Record
### Agent Model Used
claude-opus-4-8 (story draft + implementation)
### Completion Notes List
- Search page error specs run through the real `httpErrorInterceptor` (`withInterceptors`), so AC3's "no raw API error text" is asserted against the production error pipeline, not a test double.
- `POST /analyze` cannot 404 (it creates the company — 5.1); mapped 400 INVALID_TICKER to the same ticker-not-found state since the user remedy is identical. The GET summary 404 is the canonical TICKER_NOT_FOUND path.
- Company page refetches via an `effect()` on the bound `:ticker` input, so in-app ticker→ticker navigation re-renders without a component teardown; URL stays the single source of truth (AC4).
- `errorKind`/`autofocus` added to the 2.3 `SearchInputComponent` as opt-in inputs — default behaviour unchanged, existing 2.3 specs untouched and green.
- Suite: 86/86 green (72 inherited + 14 new); lint 0 errors; production build 71 kB initial transfer.
### File List
- _bmad-output/implementation-artifacts/6-1-ticker-search-component-and-company-page-routing.md
- frontend/src/app/core/api/company.models.ts (new)
- frontend/src/app/core/api/company-api.service.ts (new)
- frontend/src/app/core/api/company-api.service.spec.ts (new)
- frontend/src/app/features/search/search.component.ts (stub → page)
- frontend/src/app/features/search/search.component.spec.ts (new)
- frontend/src/app/features/company/company.component.ts (stub → page)
- frontend/src/app/features/company/company.component.spec.ts (new)
- frontend/src/app/shared/search-input/search-input.component.ts (autofocus + errorKind inputs)
- frontend/src/app/shared/search-input/search-input.component.spec.ts (2 new specs)
- frontend/src/app/app.config.ts (withComponentInputBinding)

## Change Log
- 2026-06-06: Story drafted; implementation completed — API client, search page, company page + routing; 86/86 green; moved to review.
