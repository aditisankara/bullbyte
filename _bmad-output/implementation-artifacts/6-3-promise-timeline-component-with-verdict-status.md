# Story 6.3: Promise Timeline Component with Verdict Status

Status: review

## Story

As a **retail investor**,
I want to see a chronological 8-quarter promise timeline with colour-coded verdict statuses for any company,
So that I can immediately grasp management's track record across time without reading every claim individually.

## Acceptance Criteria

1. **Given** a company page rendering completed analysis (summary `success`, not a live QUEUED/RUNNING run)
   **When** the timeline region renders
   **Then** it fetches `GET /api/v1/companies/:ticker/claims` and renders the `app-promise-timeline` plus a list of `app-claim-card`s in chronological (oldest-first) order across up to 8 quarters (FR31); a cached ticker reaches first paint well within 30 seconds (NFR2 — a single Postgres-backed GET, no FastAPI call)

2. **Given** a claim card is rendered
   **When** a user views it
   **Then** it shows the verdict badge (colour **and** text label), the metric summary, the quarter label, and speaker attribution (FR32); a pending claim (`verdict: null` from the API) renders as the `PENDING` verdict, and verdict status is never communicated by colour alone (NFR22, UX-DR2) — both guaranteed by the 2.4 `app-claim-card` / `app-verdict-badge`, this story only feeds them mapped data

3. **Given** the user selects a quarter on the timeline (or clears to "All quarters")
   **When** the selection changes
   **Then** the claim list filters to that quarter's claims and the timeline highlights it (FR33), and the selection is reflected in the URL as `?quarter=Q3-2024` so the view is shareable — a direct load of that URL restores the same filtered, highlighted state

4. **Given** a user focuses a claim card via keyboard and presses Enter/Space
   **When** the card is activated
   **Then** the card's `claimSelect` fires, the page records the selected claim id and marks the card `selected` (the 2.4 card is already a real focusable `<button>`, so it is keyboard-operable per UX-DR7); the visible claim **detail panel** and the focus-move-to-panel / focus-return-on-close choreography (NFR21) land in Story 6.5, which consumes this selection contract

5. **Given** the timeline renders on desktop (≥1280px)
   **When** viewed alongside the score and detail slots
   **Then** the timeline (full-width) and the claims column compose within the existing `app-company-page-layout` so score, timeline, and detail are visible together without horizontal scroll (UX-DR8) — this story fills the `[timeline]` and `[claims]` slots only

6. **Given** the timeline renders on mobile (≥320px)
   **When** a user scrolls
   **Then** all claim cards and the 8-quarter bar are readable with no horizontal overflow (NFR23) — satisfied by the 2.4 responsive specs and the shared `BREAKPOINTS`

## Tasks / Subtasks

- [x] Task 1: Typed claims client + frontend DTO mirrors (AC1)
  - [x] `core/api/claim.models.ts` (new) — mirror the 5.5 contracts exactly: `ClaimVerdictApi` (`id`, `verdictType: 'DELIVERED' | 'MISSED' | 'INSUFFICIENT_DATA' | 'REVISED'`, `delta: string | null`, `confidenceScore: number | null`, `isCorrection`, `createdAt`), `ClaimListItem` (`id`, `quarter`, `rawQuote`, `speaker: string | null`, `metric`, `targetValue`, `targetUnit: string | null`, `extractionConfidence`, `verdict: ClaimVerdictApi | null`), `ClaimListResponse` (`data`, `meta: { total, page, pageSize }`). **`PENDING` never appears in `verdictType`** — a pending claim is `verdict: null` (5.5 AC1)
  - [x] `core/api/company-api.service.ts` — add `getClaims(ticker): Observable<ClaimListResponse>` against `${base}/${encodeURIComponent(ticker)}/claims` (same error-interceptor seam as `getSummary`)
  - [x] Spec: URL + envelope typing (extend `company-api.service.spec.ts`)

- [x] Task 2: Pure DTO→presentation mapper (AC1, AC2, AC3) — **the heart of this story**
  - [x] `features/company/claim-mapping.ts` (new) — `toClaimSummaries(items): ClaimSummary[]` and `toQuarterColumns(items): QuarterColumn[]`, both pure
  - [x] **Pending → `PENDING`**: `verdict?.verdictType ?? 'PENDING'` (the 5.5 API drops `PENDING`; the 2.4 `Verdict` union keeps it). Map this for both the card badge and the timeline segment
  - [x] **Quarter format bridge**: API stores `"Q3-2024"` (dash); the 2.4 `ClaimSummary`/`QuarterColumn` display `"Q3 2024"` (space). Convert for display; keep the canonical dash form as the stable URL/filter key
  - [x] **Speaker fallback**: `speaker ?? 'Unknown speaker'` (`ClaimSummary.speaker` is required; API allows null)
  - [x] **Confidence source**: `verdict?.confidenceScore ?? extractionConfidence` (both 0–1) — show verification confidence once resolved, extraction confidence while pending or when the verdict carries no score; feeds the 2.2 `app-confidence-indicator` (low-confidence threshold 0.6, shared with 5.5)
  - [x] **Delta**: `verdict?.delta ?? undefined` (the card renders + colours it by sign only when present)
  - [x] **Chronological sort**: the 5.5 list arrives newest-first (year desc, quarter desc); sort oldest-first to match `DEFAULT_TIMELINE_DIRECTION` and AC1's "chronological order"
  - [x] **8-quarter columns with gaps**: group claims by quarter; emit a contiguous oldest→newest span of `QuarterColumn`s, inserting `{ quarter, verdicts: [] }` for any quarter inside the span with no claims (the 2.4 timeline already renders the empty-quarter baseline) — bounded to ≤8 columns
  - [x] `metric` ← `metric`, `quote` ← `rawQuote`; `targetValue`/`targetUnit` are carried by 6.5's detail panel, not the card
  - [x] Spec (isolated, the trickiest logic): pending→PENDING, quarter reformat, null speaker, confidence precedence, delta passthrough, newest-first→oldest-first sort, empty-quarter gap fill, ≤8 columns

- [x] Task 3: Fill the timeline + claims slots on the company page (AC1, AC3, AC5, AC6)
  - [x] `features/company/company.component.ts` — in the dashboard branch (summary `success` **and** no `liveJobId`), fetch claims via `getClaims` with its **own** 4-state `LoadState` signal (`claimsState`), so a claims failure renders an inline error in the region without tearing down the page header; `(completed)` from 6.2 already calls `load()` → on COMPLETED the dashboard branch renders and triggers the claims fetch
  - [x] Replace the `[timeline]` placeholder with `<app-promise-timeline timeline [columns]="columns()" [selectedIndex]="selectedIndex()" (selectQuarter)="onSelectQuarter($event)" />`
  - [x] Replace the `[claims]` placeholder with the mapped card list: `@for` of `visibleClaims()` → `<app-claim-card [claim]="c" [selected]="c.id === selectedClaimId()" (claimSelect)="onSelectClaim($event)" />`; empty (`total: 0`, 200 not 404 — 5.5 AC4) → a calm "No claims yet" message, not an error
  - [x] Quarter filter: `selectedQuarter` signal holds the canonical `"Q3-2024"` key; `selectedIndex` computed maps it to the timeline's source index; `visibleClaims` filters to the selected quarter or returns all when null; the timeline's `selectQuarter` emits a stable source index → map back to the quarter key
  - [x] **URL reflection (AC3)**: bind a `quarter` query param as a component input (the route already uses `withComponentInputBinding`) to seed `selectedQuarter` on direct/deep load; on selection, `Router.navigate` with `queryParamsHandling: 'merge'` to write `?quarter=` (or drop it on "All quarters"). The broader deep-link/accessibility audit is Story 6.7 — here, only the quarter filter is URL-bound
  - [x] Spec: COMPLETED summary fetches + renders timeline and cards in chronological order; quarter select filters the list + writes the query param; deep load with `?quarter=` restores the filtered state; empty claims → "No claims yet"; claims fetch error → inline error, header intact; a live (RUNNING) summary still shows the 6.2 feed and does **not** fetch claims

- [x] Task 4: Selection contract for the detail panel (AC4)
  - [x] `selectedClaimId` signal set by `onSelectClaim`; bound to each card's `selected`; exposed as the seam 6.5's `ClaimDetailPanel` will consume (and 6.5 owns opening the panel + WCAG focus move/return). Keep the `[detail]` slot as the 6.5 placeholder
  - [x] Spec: activating a card records the id and flips that card's `selected`; activating another card moves the selection

- [x] Task 5: Verify — frontend `ng test` green (existing suite + new mapper/company specs), `ng lint` clean, `ng build` clean; confirm no horizontal overflow at 320px and the 3-pane composition at 1280px (manual responsive check against the 2.6 layout). **Frontend-only story** — no `api/` or `ml-sidecar/` files touched (the 5.5 endpoint is already on main, PR #91)

## Dev Notes

### What already exists (do not rebuild)
- **Presentational** (2.4): `shared/promise-timeline/promise-timeline.component.ts` (`app-promise-timeline`, inputs `columns`/`selectedIndex`/`direction`, output `selectQuarter` emitting a **stable source index** across direction flips, empty-quarter baselines, 5-tone legend) and `shared/claim-card/claim-card.component.ts` (`app-claim-card`, input `claim: ClaimSummary` + `selected`, output `claimSelect: string`; a real focusable `<button>` via the stretched-link pattern, verdict by icon+label+delta not colour — NFR22/UX-DR7). This story feeds them mapped data and wires their outputs; it adds **no** new presentational components.
- **Models** (2.4): `shared/claim/claim.ts` — `ClaimSummary` (`quarter` display form `"Q1 2024"`, required `speaker`, single `confidence` 0–1, optional `delta`) and `QuarterColumn` (`quarter`, `verdicts: Verdict[]`). `shared/verdict/verdict.ts` — the 5-state `Verdict` union (incl. `PENDING`) + `VERDICT_META`.
- **Layout** (2.6): `app-company-page-layout` projects four slots — `[score]`, `[timeline]`, `[claims]`, `[detail]`. Timeline is full-width above a body row of claims (left) + a sticky detail rail (right). Timeline and claims are **separate slots**, so a single child can't render both — orchestration lives on the page (`company.component`), exactly as it owns `getSummary` today.
- **Page** (6.1/6.2): `company.component.ts` — 4-state `LoadState`, `liveJobId` computed, `load()`, and the dashboard-vs-live-run branch. This story fills the two placeholder sections in the dashboard branch.

### The API↔presentation gap (why Task 2 exists)
The 5.5 claim DTO and the 2.4 `ClaimSummary` were authored independently and disagree on four points — the mapper is the single reconciliation seam, kept pure so the edge cases are unit-tested without a TestBed:
- pending verdict: API `verdict: null` ↔ presentation `Verdict = 'PENDING'`
- quarter: API `"Q3-2024"` (dash, also the URL key) ↔ display `"Q3 2024"` (space)
- speaker: API `string | null` ↔ presentation required `string`
- confidence: API splits `extractionConfidence` and `verdict.confidenceScore` ↔ presentation single `confidence`

### Quarter filter, index, and the URL
- The timeline emits a **source index** (stable regardless of direction); the page maps `selectedQuarter` (canonical `"Q3-2024"`) ↔ index. Keep the dash form in the URL — unambiguous and parse-free. The space form is display-only.
- `withComponentInputBinding` already binds route params to inputs; query params bind the same way, so `quarter` arrives as an input for deep-load seeding. Writing it back uses `Router.navigate([], { queryParams, queryParamsHandling: 'merge' })`. Full deep-linking + a11y audit is Story 6.7 — scope here is just the quarter filter.

### Performance (NFR2)
A cached ticker's summary is already loaded; the claims region adds one Postgres-backed GET (`5.5` makes no FastAPI calls) and a synchronous signal-driven render. First paint is structurally far under 30s; no streaming or polling here (that is the 6.2 live run).

### Scope boundaries — what this story does NOT do
- **No claim detail panel and no focus choreography** — Story 6.5 owns the panel, the open/close, and the WCAG focus move-to-panel / return-to-card (NFR21). 6.3 delivers the selection contract (`selectedClaimId` + the card's `selected`) it builds on.
- **No score card** — the `[score]` slot stays the 6.4 placeholder.
- **No reasoning trace** — 6.5/6.6.
- **No new API or DTO fields** — the 5.5 contract is consumed as-is; `targetValue`/`targetUnit` ride through for 6.5 and are not shown on the card.
- **No changes to the 2.4 presentational components** — if a gap surfaces, prefer mapping over editing the shared component.

### References
- [Source: epics.md — Story 6.3]
- [Source: api/src/claims/claims.controller.ts — `GET companies/:ticker/claims` (5.5, PR #91)]
- [Source: api/src/claims/dto/claim-list.dto.ts, claim-verdict.dto.ts — the contract to mirror]
- [Source: frontend/src/app/shared/promise-timeline/promise-timeline.component.ts — 2.4]
- [Source: frontend/src/app/shared/claim-card/claim-card.component.ts — 2.4]
- [Source: frontend/src/app/shared/claim/claim.ts — ClaimSummary / QuarterColumn]
- [Source: frontend/src/app/shared/company-page-layout/company-page-layout.component.ts — 2.6 slots]
- [Source: frontend/src/app/features/company/company.component.ts — 6.1/6.2 page orchestration]

## Dev Agent Record
### Agent Model Used
claude-opus-4-8 (story draft + implementation)
### Completion Notes List
- **Implementation note vs. the draft:** the mapper exports `buildTimeline(items): { columns, keys }` rather than a bare `toQuarterColumns`. The page needs the canonical `"Q3-2024"` keys *parallel to the columns* to translate the timeline's emitted source index ↔ the quarter filter ↔ the URL param, so returning columns and keys together from one pass avoids recomputing the grouping twice. `toClaimSummaries` is the second export.
- **Two-slot constraint resolved at the page, not in a child.** `app-promise-timeline` (full-width) and the claim-card list live in *different* `CompanyPageLayout` slots, so no single child can own both. `company.component` orchestrates: one `getClaims` fetch → `timeline()` / `visibleClaims()` computed signals feed the two slots. The reconciliation logic that *could* be unit-tested in isolation lives in the pure `claim-mapping.ts` (12 specs, no TestBed); the component spec covers the wiring.
- **URL is the single source of truth for the filter.** `onSelectQuarter` only navigates (`['/company', ticker]` + merged `?quarter=`); `withComponentInputBinding` round-trips the change back into the `quarter` input, which drives `selectedQuarter` → `selectedIndex` (timeline highlight) and `visibleClaims` (list filter). No local filter signal to fall out of sync. Navigates to the explicit company path (matching 6.1's `SearchComponent` style) rather than `relativeTo: ActivatedRoute`, so the component needs only `Router` — consistent with the codebase and avoids an `ActivatedRoute` test dependency.
- **Claims region has its own `LoadState`** (`claimsState`) separate from the page `state`, so a claims fetch failure shows an inline `app-error-state` inside the layout while the company header stays intact (AC1's resilience). Empty claims (5.5 AC4: `200` + `{data:[]}`) render a calm "No claims yet", not an error.
- **Live-run boundary:** claims are fetched only when the summary is **not** live (`isLive` = QUEUED/RUNNING + non-null jobId), so a RUNNING summary shows the 6.2 SSE feed and issues no claims request (asserted with `http.expectNone`).
- **`PENDING` round-trip:** the API omits `PENDING` (pending = `verdict: null`); the mapper restores it as the `PENDING` tone for both the card badge and the timeline segment, so pending claims are visible on the timeline rather than dropped.
- **Confidence precedence:** `verdict.confidenceScore ?? extractionConfidence` — verification confidence once resolved, extraction confidence while pending/unscored. Flag for review if the card should always show extraction confidence instead (one-line change).
- **8-quarter gap-fill** synthesises empty columns across the oldest→newest span for a continuous axis, but falls back to the present quarters if gap-filling would exceed 8 columns — so a claim-bearing quarter is never dropped to honour FR31's cap.
- Suites: frontend **121/121** (was 100 → +21: 12 mapper, +6 company, +1 api, +2 existing updated to flush claims), `ng lint` clean, production `ng build` clean. **Frontend-only** — no `api/` or `ml-sidecar/` files touched (5.5 endpoint already on main, PR #91).
### File List
- _bmad-output/implementation-artifacts/6-3-promise-timeline-component-with-verdict-status.md
- frontend/src/app/core/api/claim.models.ts (new — 5.5 DTO mirror)
- frontend/src/app/core/api/company-api.service.ts (getClaims)
- frontend/src/app/core/api/company-api.service.spec.ts (getClaims spec)
- frontend/src/app/features/company/claim-mapping.ts (new — pure DTO→presentation mapper)
- frontend/src/app/features/company/claim-mapping.spec.ts (new — 12 specs)
- frontend/src/app/features/company/company.component.ts (timeline + claims slots, filter, selection)
- frontend/src/app/features/company/company.component.spec.ts (6 new specs + 4 updated to flush claims)

## Change Log
- 2026-06-08: Story drafted from epics.md §6.3, grounded against the merged 5.5 claims endpoint (PR #91) and the 2.4 timeline/claim-card components. Centred on the DTO→presentation mapper and the two-slot page wiring; claim-detail panel + focus management explicitly deferred to 6.5. Status: ready-for-dev.
- 2026-06-08: Implemented — claims client + DTO mirror, pure `claim-mapping` (PENDING restore, quarter-format bridge, speaker/confidence fallbacks, chronological sort, 8-quarter gap-fill), and company-page wiring for the timeline + claims slots with the quarter filter reflected in `?quarter=` and the claim-selection contract for 6.5. Frontend 121/121, lint + build clean. Status: review.
