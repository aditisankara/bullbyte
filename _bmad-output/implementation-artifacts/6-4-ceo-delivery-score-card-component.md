# Story 6.4: CEO Delivery Score Card Component

Status: review

## Story

As a **retail investor**,
I want to see a CEO Delivery Score card that tells me both the score and exactly how many claims it is based on,
So that I can assess management credibility at a glance while understanding the statistical weight behind the number.

## Acceptance Criteria

1. **Given** a company page loads with at least one resolved verdict
   **When** the `ScoreCardComponent` renders
   **Then** it fetches `GET /api/v1/companies/:ticker/score` and displays the score, delivered count, total resolved, and pending count (FR22, FR23, FR24, UX-DR4)
   **And** the score is never shown as a bare fraction — sample-size context is always present (FR23)

2. **Given** a company with no resolved claims (API returns `score: null`)
   **When** the score card renders
   **Then** it displays "No resolved claims yet" rather than a score of 0 or an error state
   **And** the pending claim count is shown so the user knows when to check back

3. **Given** the score card renders
   **When** it is inspected for accessibility
   **Then** the score value uses a semantic heading element
   **And** the context text is readable by screen readers as a single coherent sentence

4. **Given** the score card renders on tablet and mobile
   **When** the layout adapts
   **Then** the score and context text remain legible at all supported breakpoints (UX-DR8, NFR23)

## Tasks / Subtasks

- [x] Task 1: Typed score client + DTO mirror (AC1) — no API changes; 5.6 is consumed as-is
  - [x] `core/api/company.models.ts` — add `CeoScoreDto` mirror of the API's `CeoScoreDto` (5.6): `{ ticker, score: number | null, deliveredCount, missedCount, totalResolved, pendingCount, insufficientDataCount, context }`. **Mirror the wire shape exactly** — do not reshape into the 2.6 presentational model here (that mapping lives in the smart component). Named `CeoScoreDto` (not `CeoScore`) to avoid clashing with the shared 2.6 presentation model.
  - [x] `core/api/company-api.service.ts` — add `getScore(ticker): Observable<CeoScoreDto>` → `GET ${base}/:ticker/score`, same `encodeURIComponent` + interceptor pattern as `getSummary`
  - [x] Service spec with `HttpTestingController`: resolved-score response, `score: null` response
  - [x] **Frontend-only** — the 5.6 endpoint already ships every field; no `api/` files were touched

- [x] Task 2: Reconcile the presentational `CeoScoreCardComponent` (2.6) with the real API shape — opt-in inputs only (AC1, AC3, AC4)
  - [x] Add opt-in `contextOverride` — when set, the card renders that sentence verbatim instead of its self-computed `sampleContext()`. The smart component feeds the API's authoritative `context` string, so the sample-size text is server truth (FR23) and the absent `quarters` field is sidestepped.
  - [x] Add opt-in `showTrend` (default `true`) — set `false` to suppress the trend block when no prior-window comparison exists (5.6 ships no trend datum).
  - [x] Add opt-in `showRevised` (default `true`) — set `false` to drop the Revised stat row, which 5.6 silently excludes.
  - [x] Guard the CEO attribution behind `@if (s.ceo)` so an empty name renders just the context (no stray separator).
  - [x] AC3 — the score value now lives in a semantic heading: the numeric ring readout is an `<h2>` with `aria-label` "CEO Delivery Score N out of 10"; the "CEO Delivery Score" label is demoted to an eyebrow `<p>`; the ring SVG is marked decorative (`aria-hidden`). The context `<p>` carries an `aria-label` so it reads as one clean sentence.
  - [x] 2.6 spec updated for the heading move; the three new opt-ins default to prior behaviour (verified)

- [x] Task 3: `ScoreCardComponent` — the smart card (AC1–AC4)
  - [x] `features/company/score-card.component.ts` — input `ticker`; fetch `getScore` via an `effect`/`untracked` load; 4-state `LoadState` signal
  - [x] `score === null` branch (AC2): a dedicated **"No resolved claims yet"** empty state showing `pendingCount` ("N claims are still pending — check back once they resolve") — not the ring at 0, not an error state
  - [x] resolved branch (AC1): adapt the API `CeoScoreDto` (0–1) into the 2.6 `CeoScore` model and render `<app-ceo-score-card>`:
    - `score` ← `dto.score * 10` (0–1 → 0–10 ring)
    - `contextOverride` ← `dto.context` (authoritative sample-size sentence — FR23)
    - `ceo` ← `''` (attribution deferred by 5.6 — the page `<h1>` carries the company; the card shows context alone)
    - `counts` ← `{ delivered, missed, pending, insufficient: insufficientDataCount || undefined, revised: 0 }`
    - `showTrend: false`, `showRevised: false`
  - [x] On API error, render a compact inline note (not the full-page error state); a known ticker with zero claims is the AC2 null path, not an error
  - [x] Spec: resolved → ring + counts + context; `score: null` → empty state + pending; trend & revised suppressed; score value is a heading (AC3); error → inline note

- [x] Task 4: Wire into the company page score slot (AC1)
  - [x] `features/company/company.component.ts` — the placeholder `<section score>` now hosts `<app-score-card [ticker]="normalisedTicker()" />`. The live-run branch (6.2 SSE feed) is untouched; on `(completed)` the summary refetch leaves the live branch and the card mounts + fetches.
  - [x] Spec: a completed (non-live) summary renders the card in the score slot; QUEUED/RUNNING still renders the 6.2 feed

- [x] Task 5: Verify — `ng test` 113/113 green, `ng lint` clean, `ng build` clean (72.46 kB initial transfer); no `api/` files touched

## Dev Notes

### API contract (from 5.6 — do not re-shape)
- `GET /api/v1/companies/:ticker/score` → `200 CeoScoreDto { ticker, score, deliveredCount, missedCount, totalResolved, pendingCount, insufficientDataCount, context }` or `404 TICKER_NOT_FOUND`.
- `score` is `deliveredCount / totalResolved` on a **0–1** scale, or **`null` (never 0)** when `totalResolved == 0`, with `context: "No resolved claims yet"`. The resolved `context` reads like `"3 of 5 resolved promises delivered — 4 pending — 1 insufficient data"`.
- `totalResolved = deliveredCount + missedCount` only; `pendingCount` includes claims with no verdict row yet; `REVISED` is silently excluded.

### The 2.6 ⇄ 5.6 model mismatch (the heart of this story)
The presentational `CeoScoreCardComponent` (2.6) was specified before 5.6 landed and assumed fields the endpoint does **not** return. This story is mostly the adapter that reconciles them — it does **not** rebuild the card:

| 2.6 presentational `CeoScore` | 5.6 `CeoScoreDto`               | Bridge                                            |
| ----------------------------- | ------------------------------- | ------------------------------------------------- |
| `score` 0–10                  | `score` 0–1 \| null             | `* 10`; `null` → dedicated empty state (AC2)      |
| `ceo` (required name)         | — (deferred)                    | `''` — attribution omitted (page `<h1>` has it)   |
| `quarters` window             | — (only a `context` string)     | `contextOverride` passes the server sentence      |
| `trend` (required)            | — (no prior-window datum)       | `showTrend: false` — suppress, don't fabricate    |
| `counts.revised`              | — (REVISED excluded)            | `showRevised: false`                              |
| `counts.delivered/missed/pending` | `deliveredCount/missedCount/pendingCount` | direct                          |
| —                             | `insufficientDataCount`         | `counts.insufficient` (omitted when 0)            |

### Why suppress the trend (FR24 deferral)
2.6 defined the up/flat/down treatment but noted "the comparison value is supplied by the API when 4.6/5.6 land." 5.6 shipped **no** prior-window comparison — `CeoScoreDto` has no trend field — so a truthful trend cannot be computed from the current endpoint. Showing a fabricated "Steady" would be misleading, so the indicator is suppressed (`showTrend: false`) until the score endpoint returns a prior-window score. **Deferred work**: FR24 visual trend needs an API change (a prior-window score on `CeoScoreDto`), not a frontend one.

### Why no CEO-name attribution
5.6 explicitly left CEO-name attribution out of scope ("no FR, no 6.4 AC, and no Epic 2 score-card spec consumes a `ceoName` field"). The 6.4 ACs ask for score / delivered / total / pending — never a CEO name. The card therefore shows the context sentence alone; the company name is already the page `<h1>`. If the API later adds `ceoName`, it's a one-field change (pass it as `ceo`).

### Null score is an empty state, not an error (AC2)
A known ticker with zero resolved claims returns `200` with `score: null` — a normal, expected state. It renders "No resolved claims yet" plus the pending count, never the ring at 0 and never the error path. Only transport/HTTP failures render the compact inline note.

### AC3 — score in a heading, context as one sentence
The numeric readout is an `<h2>` whose `aria-label` is "CEO Delivery Score N out of 10", so heading-navigation lands on the score; the decorative ring SVG is `aria-hidden`. The context `<p>` carries an `aria-label` equal to the authoritative sentence, so the `·`-separated visual text isn't read literally.

### What this story does NOT do
- No API changes — 5.6 already serves every field consumed here.
- No trend indicator (deferred — needs a prior-window score from the API; see above).
- No timeline / claims / detail panels — 6.3 / 6.5 / 6.6 own those slots; this story fills only the `score` slot.
- No live-run behaviour — the 6.2 SSE feed owns `QUEUED|RUNNING`; the card renders in the completed (non-live) layout.

### References
- [Source: epics.md — Story 6.4]
- [Source: api/src/score/dto/ceo-score.dto.ts; api/src/score/score.service.ts — 5.6 wire contract + context format]
- [Source: _bmad-output/implementation-artifacts/5-6-ceo-score-endpoint-and-immutable-verdict-writes.md — score invariants, CEO-name + trend deferral]
- [Source: frontend/src/app/shared/ceo-score-card/ceo-score-card.component.ts — 2.6 presentational card]
- [Source: frontend/src/app/shared/score/ceo-score.ts — 2.6 presentation model]
- [Source: frontend/src/app/features/company/company.component.ts — 6.1/6.2 integration point + load pattern]
- [Source: frontend/src/app/core/api/company-api.service.ts — 6.1 typed client pattern]

## Dev Agent Record
### Agent Model Used
claude-opus-4-8 (story draft + implementation)
### Completion Notes List
- Developed in an isolated git worktree branched off `origin/main` (d8be91e) — `origin/main` already carries the merged 5.5/6.2 work (one PR per story preserved). The primary clone has in-flight 6.3 frontend work (`getClaims`/`claim.models`) that is **not** on `origin/main`; the worktree is clean of it, so this story's diff is isolated.
- Frontend-only: 5.6 already serves `GET /companies/:ticker/score` with every field, so zero `api/` files were touched. The only API-side dependency is consuming the shipped DTO.
- The core of the story is the 2.6⇄5.6 adapter. The presentational card was reused (not rebuilt) via three opt-in inputs (`contextOverride`, `showTrend`, `showRevised`) — the same opt-in pattern 6.1/6.2 established — so all prior 2.6 specs stay green.
- `score: null` routes to a first-class "No resolved claims yet" empty state that surfaces the pending count (AC2) — never a 0 ring, never the error state. Only transport failures render the compact inline "unavailable" note.
- Trend is suppressed (not fabricated): 5.6 returns no prior-window datum, so FR24's visual trend is recorded as deferred work pending an API change. CEO-name attribution is likewise omitted (5.6 deferred it; no 6.4 AC needs it) — the card shows the authoritative context sentence alone.
- AC3: the score value was moved into an `<h2>` (aria-label "CEO Delivery Score N out of 10") with the ring SVG made decorative; the "CEO Delivery Score" label became an eyebrow `<p>`. The context paragraph carries a clean aria-label sentence.
- Suites: frontend **113/113** (99 inherited + 14 new across the api-service, presentational-card, smart-card, and company-page specs); `ng lint` clean; production build clean at 72.46 kB initial transfer (NFR3 headroom).
### File List
- _bmad-output/implementation-artifacts/6-4-ceo-delivery-score-card-component.md
- _bmad-output/implementation-artifacts/sprint-status.yaml (6-4 → review)
- frontend/src/app/core/api/company.models.ts (CeoScoreDto mirror)
- frontend/src/app/core/api/company-api.service.ts (getScore)
- frontend/src/app/core/api/company-api.service.spec.ts (2 new specs)
- frontend/src/app/shared/ceo-score-card/ceo-score-card.component.ts (opt-in inputs + AC3 heading)
- frontend/src/app/shared/ceo-score-card/ceo-score-card.component.spec.ts (heading update + 4 new specs)
- frontend/src/app/features/company/score-card.component.ts (new — smart card)
- frontend/src/app/features/company/score-card.component.spec.ts (new)
- frontend/src/app/features/company/company.component.ts (score slot wiring)
- frontend/src/app/features/company/company.component.spec.ts (score-fetch flushes + heading assertion)

## Change Log
- 2026-06-08: Story drafted from epics.md §6.4, grounded against the shipped 5.6 score endpoint and the 2.6 presentational card. Status: ready-for-dev.
- 2026-06-08: Implemented in an isolated worktree off origin/main — typed `getScore` client, the 2.6⇄5.6 adapter (three opt-in inputs on the presentational card), the smart score card with the AC2 null-score empty state, and company-page wiring. Frontend 113/113, lint + build clean. Status: review.
