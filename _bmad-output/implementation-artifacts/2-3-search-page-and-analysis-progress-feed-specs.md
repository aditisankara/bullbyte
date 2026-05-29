# Story 2.3: Search Page & Analysis Progress Feed Specs

Status: review

## Story

As the **frontend developer**,
I want the search entry point and the live analysis progress feed designed and specified,
So that the primary entry point and BullByte's transparency mechanism are ready to implement in Epic 6 (6.1, 6.2).

## Acceptance Criteria

1. **Given** the Search Page
   **Then** it defines layout, search input, placeholder, submit action, and the four states of the loading union: idle, loading, success (redirect), error (ticker not found)
   **And** the input has a visible WCAG-AA focus indicator (UX-DR7)

2. **Given** the Analysis Progress Feed
   **Then** it defines the step-message layout and typography and the visual treatment for **in-progress** (active indicator), **completed**, and **failed** (error indicator) steps (UX-DR1)
   **And** messages append as each agent step completes — no skeleton/placeholder replaces the whole feed (NFR5)
   **And** it includes example step messages ("Locating earnings call transcripts…", "Extracted N claims…", "Verifying claim M of N…")

3. **Given** the keyboard-navigation requirements
   **Then** all interactive search elements are reachable and operable via Tab and Enter (UX-DR7, NFR21)

## Gaps to close (this story)

- 🔴 **Analysis Progress Feed — does not exist** in the design (no component, no specimen). This is the UI for the SSE pipeline shipped in 5.2/5.3. Design its step-feed + the three step states + example copy. It maps to the SSE event contract `{ event, jobId, stepIndex, totalSteps, message, timestamp }`.
- 🟡 **Search 4-state union**: design covers idle (TopNav input + Landing hero) but not loading/success/error visuals. Spec the loading + error states.

## Tasks / Subtasks

- [x] Task 1: Search input states (idle/loading/success/error) + focus indicator (AC1, AC3)
- [x] Task 2: `AnalysisProgressFeed` component — step item with in-progress/completed/failed states; append-only; example messages (AC2)
- [x] Task 3: Map step events to the canonical SSE event names (analysis-started … analysis-complete/failed)
- [x] Task 4: Tests (state rendering; append-not-replace; terminal states)

## Dev Notes

- Visual reference: `ui_kits/dashboard/TopNav.jsx` (search input), `Landing.jsx` (idle hero). **No** progress-feed reference exists — design it from scratch on-brand (mono step text, hairline rows, verdict-style status glyphs).
- Don't conflate with the **reasoning trace** (per-claim, post-hoc) — that's 2.5. This is the live run feed.
- The SSE contract is already implemented: `api/src/jobs/dto/progress-event.dto.ts`.

### References
- [Source: epics.md — Story 2.3]
- [Source: api/src/jobs/dto/progress-event.dto.ts — SSE event contract]

## Dev Agent Record
### Agent Model Used
claude-opus-4-8
### Completion Notes List
- `SearchInput` (`app-search-input`): `role="search"` form, ticker input (mono/uppercase once typed) + submit. Models the 4-state union via a `state` input (idle/loading/success/error); emits `tickerSearch` with the trimmed+uppercased ticker. Loading disables the field + shows a spinner with `aria-busy`/`role=status`; success shows a polite confirmation; error reuses the 2.2 `ErrorState` (`ticker-not-found`) with the submitted ticker as context and a retry that refocuses. Visible AA focus via the global gold `:focus-visible` plus a `:focus-within` border (UX-DR7); fully keyboard-operable (native input + button, submit on Enter — NFR21).
- `AnalysisProgressFeed` (`app-analysis-progress-feed`): renders one row per received `ProgressEvent` in an `aria-live="polite"` / `aria-relevant="additions"` `role="log"` (append-only, no full-feed skeleton — NFR5). Step states (UX-DR1): completed (check glyph), failed (slash glyph, missed-ink), and a synthetic trailing **in-progress** row (pulsing gold dot, honours `prefers-reduced-motion`) shown only while the run is live. Example messages exercised in tests. Distinct from the per-claim reasoning trace (2.5).
- SSE mapping (Task 3): added `shared/analysis/progress-event.ts` mirroring `api/src/jobs/dto/progress-event.dto.ts` — `SSE_EVENTS`, `TERMINAL_EVENTS`, `ProgressEvent`, `isTerminal()`, and `statusForEvent()`. Documented as a shared contract that must stay in sync with the API DTO.
- Output named `tickerSearch` (not `search`) to avoid clashing with the native DOM `search` event (lint rule `no-output-native`).
- Tests: 14 new (search states + emit + disabled-empty + error context; feed append-not-replace, in-progress trailer, terminal complete/failed; SSE contract mapping). Full suite **38/38 green**; `ng lint` clean; `ng build` succeeds.

### Decisions
- These are presentational components under `shared/`, with state driven by a parent `input` and intent surfaced via outputs — Epic 6 (6.1 search wiring / 6.2 SSE subscription) supplies the live data and routing.
- The in-progress indicator is a synthetic trailing row (not a received event), since every SSE event arrives only when its step *completes*; the active row represents the step currently running.

### File List
- frontend/src/app/shared/analysis/progress-event.ts
- frontend/src/app/shared/analysis/progress-event.spec.ts
- frontend/src/app/shared/analysis-progress-feed/analysis-progress-feed.component.ts
- frontend/src/app/shared/analysis-progress-feed/analysis-progress-feed.component.spec.ts
- frontend/src/app/shared/search-input/search-input.component.ts
- frontend/src/app/shared/search-input/search-input.component.spec.ts

## Change Log
- 2026-05-29: Story authored from the design-system gap analysis.
- 2026-05-29: Implemented SearchInput (4-state union + AA focus) and AnalysisProgressFeed (append-only log, 3 step states) + frontend SSE contract mirror and tests. Suite 38/38, lint + build green. Status → review.
