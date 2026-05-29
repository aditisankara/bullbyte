# Story 2.2: Core Shared Component Specs

Status: review

## Story

As the **frontend developer**,
I want the shared, reused building blocks implemented as Angular components against the design tokens, with the gaps closed,
So that feature work in Epic 6 composes from compliant primitives instead of redrawing them.

## Acceptance Criteria

1. **Given** the Verdict Badge
   **Then** it renders all **five** states — DELIVERED, MISSED, PENDING, **INSUFFICIENT_DATA**, REVISED — each with background token, text colour token, text label, and icon
   **And** colour + label always appear together, never colour alone (UX-DR2)

2. **Given** the Confidence Indicator
   **Then** it displays a confidence score (0–1) visually
   **And** low-confidence verdicts (below a **defined threshold**) get a distinct "flagged, not suppressed" treatment (FR40, UX-DR5)
   **And** the threshold value is defined in code/tokens

3. **Given** the Disclaimer Footer
   **Then** it renders the agreed canonical text in a semantic `<footer>` with the correct typography tokens, present at the bottom of every page (FR44, UX-DR10)

4. **Given** the Error State component
   **Then** it covers all four states — ticker-not-found, EDGAR-unavailable, analysis-timeout, low-confidence — each with icon, heading, body text, and a retry action where applicable (UX-DR6, NFR6)

## Gaps to close (this story)

- 🔴 **Verdict badge 5th state** (`INSUFFICIENT_DATA`): add pill variant + a glyph in `verdict-icons.svg`. Design's `VerdictPill` (`ui_kits/dashboard/Primitives.jsx`) currently has 4.
- 🔴 **Confidence indicator**: no component or low-confidence treatment exists; **pick + document the threshold** (FR40).
- 🔴 **Error states**: only ticker-not-found exists; add EDGAR-unavailable, analysis-timeout, low-confidence.
- 🟡 **Disclaimer text reconciliation**: design says "…public SEC filings **via EDGAR**"; epic AC says "…public SEC filings." Choose canonical (recommend keeping "via EDGAR").

## Tasks / Subtasks

- [x] Task 1: `VerdictBadge` component — 5 states from tokens + icons (AC1); depends on 2.1 INSUFFICIENT_DATA tokens
- [x] Task 2: `ConfidenceIndicator` component + threshold constant + low-confidence flag treatment (AC2)
- [x] Task 3: `DisclaimerFooter` component, semantic `<footer>`, canonical text (AC3)
- [x] Task 4: `ErrorState` component covering 4 states with retry (AC4)
- [x] Task 5: Component unit tests (states render, label-not-colour-alone, retry emits)

## Dev Notes

- Visual reference: `ui_kits/dashboard/Primitives.jsx` (`VerdictPill`, `VerdictIcon`, `Disclaimer`), specimens `preview/verdict-pills.html`, `preview/iconography.html`.
- Build in Angular standalone components under `frontend/src/app/shared/`; consume tokens via `var(--…)`.
- Keyboard/focus: use the global gold `:focus-visible`; ensure interactive elements are real focusable controls.

### References
- [Source: epics.md — Story 2.2]
- [Source: bullbyte-design-system/project/ui_kits/dashboard/Primitives.jsx]

## Dev Agent Record
### Agent Model Used
claude-opus-4-8
### Completion Notes List
- Built four standalone Angular components under `frontend/src/app/shared/`, all consuming Story 2.1 tokens via `var(--…)`; `ChangeDetectionStrategy.OnPush` + signal `input()`/`output()` throughout.
- `VerdictBadge`: renders all 5 states (incl. INSUFFICIENT_DATA) from `VERDICT_META`; background + ink tokens, glyph icon, and a sentence-case label that is always present (colour never alone, UX-DR2). Added the 5th glyph (dash-in-circle) inline and mirrored it into `assets/verdict-icons.svg` + README.
- `ConfidenceIndicator`: labelled meter (role=meter, aria-valuenow). Low-confidence (< `LOW_CONFIDENCE_THRESHOLD`) gets amber fill + visible "Low confidence" flag — flagged, not suppressed (FR40). Threshold exported as `LOW_CONFIDENCE_THRESHOLD = 0.6` (decision documented in code).
- `DisclaimerFooter`: semantic `<footer>` with the canonical text **"…via EDGAR"** (reconciled to the design-system source). Exported as `DISCLAIMER_TEXT`; wired into the app shell (`app.ts`/`app.html`), replacing the inline footer; `app.scss` dead rule removed; `app.spec.ts` updated to the canonical wording.
- `ErrorState`: covers all 4 states (ticker-not-found, edgar-unavailable, analysis-timeout, low-confidence) with icon + heading + body; retry button + `retry` output on the 3 recoverable states; low-confidence is non-retryable and announced with role=status (vs role=alert for failures). Copy follows the design voice; supports `heading`/`body`/`context` overrides.
- Tests: 4 new specs, all states render, label-not-colour-alone asserted, retry emission verified, threshold + clamping covered. Full suite **24/24 green**; `ng lint` clean; `ng build` succeeds.

### Decisions
- Disclaimer canonical text: **"Not financial advice. Data sourced from public SEC filings via EDGAR."** (matches design-system README; updated app + existing test to match).
- Low-confidence threshold: **0.60** (FR40), as `LOW_CONFIDENCE_THRESHOLD`.

### File List
- frontend/src/app/shared/verdict/verdict.ts
- frontend/src/app/shared/verdict-badge/verdict-badge.component.ts
- frontend/src/app/shared/verdict-badge/verdict-badge.component.spec.ts
- frontend/src/app/shared/confidence-indicator/confidence-indicator.component.ts
- frontend/src/app/shared/confidence-indicator/confidence-indicator.component.spec.ts
- frontend/src/app/shared/disclaimer-footer/disclaimer-footer.component.ts
- frontend/src/app/shared/disclaimer-footer/disclaimer-footer.component.spec.ts
- frontend/src/app/shared/error-state/error-state.component.ts
- frontend/src/app/shared/error-state/error-state.component.spec.ts
- frontend/src/app/app.ts (import DisclaimerFooter)
- frontend/src/app/app.html (use <app-disclaimer-footer/>)
- frontend/src/app/app.scss (remove dead footer rule)
- frontend/src/app/app.spec.ts (canonical disclaimer text)
- bullbyte-design-system/project/assets/verdict-icons.svg (5th glyph — source mirror)
- bullbyte-design-system/project/README.md (glyph set 4 → 5)

## Change Log
- 2026-05-29: Story authored from the design-system gap analysis.
- 2026-05-29: Implemented VerdictBadge, ConfidenceIndicator, DisclaimerFooter, ErrorState + unit tests; added 5th verdict glyph; reconciled disclaimer to "via EDGAR"; set low-confidence threshold 0.6. Suite 24/24, lint + build green. Status → review.
