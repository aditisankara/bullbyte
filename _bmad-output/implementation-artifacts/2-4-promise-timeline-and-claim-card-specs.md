# Story 2.4: Promise Timeline & Claim Card Specs

Status: review

## Story

As the **frontend developer**,
I want the promise timeline and the claim card specified and made responsive,
So that the core browsing interface for a company's promise history is ready for Epic 6 (6.3).

## Acceptance Criteria

1. **Given** the Promise Timeline
   **Then** it defines the chronological layout spanning up to 8 quarters, the quarter filter/navigation control, and how quarters with no claims are represented
   **And** the timeline direction (newest-first or oldest-first) is explicitly specified (FR31, FR33)

2. **Given** the Claim Card
   **Then** it defines verdict badge, claim metric summary, quarter label, **speaker attribution**, and **confidence indicator**
   **And** hover **and** keyboard-focus states are specified (UX-DR7)
   **And** cards with different verdicts are distinguishable by layout and label, not colour alone (NFR22)

3. **Given** responsive behaviour
   **Then** desktop (≥1280px) shows timeline + claim detail + score simultaneously without scrolling; tablet (768–1279px) stacks vertically; mobile (≥320px) is legible with no horizontal scroll (NFR23, UX-DR8)

## Gaps to close (this story)

- 🔴 **Speaker attribution** missing from the claim card (and the fake data). Add the field + display.
- 🔴 **Confidence indicator** missing from the card (use the 2.2 component).
- 🔴 **Keyboard focusability**: design's `ClaimRow` is a `<div onClick>` (mouse-hover only). Make it a real focusable control with a focus state.
- 🔴 **Responsive specs** absent — define desktop/tablet/mobile behaviour (shared with 2.6).
- 🟡 **Timeline**: define empty-quarter representation; state direction explicitly (kit is oldest-first); upgrade quarter "select" to a proper filter/navigation control.

## Tasks / Subtasks

- [x] Task 1: `PromiseTimeline` — 8-quarter layout, explicit direction, empty-quarter state, filter control (AC1)
- [x] Task 2: `ClaimCard` — verdict badge + metric + quarter + speaker + confidence; hover + focus; layout-distinct (AC2)
- [x] Task 3: Responsive breakpoints for timeline + claim layout (AC3)
- [x] Task 4: Tests (keyboard focus/activation; empty-quarter; verdict distinction without colour)

## Dev Notes

- Visual reference: `ui_kits/dashboard/Timeline.jsx` (`PromiseTimeline`, `ClaimTable`, `ClaimRow`), specimens `preview/promise-timeline.html`, `preview/claim-row.html`.
- Decide card vs table-row form (design uses a row; AC says "card") — pick one and apply consistently.
- Speaker attribution and confidence must also align with the real Epic-5 claim DTO when 5.5 lands.

### References
- [Source: epics.md — Story 2.4]
- [Source: bullbyte-design-system/project/ui_kits/dashboard/Timeline.jsx]

## Dev Agent Record
### Agent Model Used
claude-opus-4-8
### Completion Notes List
- `ClaimCard` (`app-claim-card`): verdict badge (sm) + quarter (mono) + metric + quote (serif) + **speaker attribution** + **ConfidenceIndicator** (both 2.2 components reused). Built as a **card** (per AC, not the kit's table row). Keyboard-reachable/operable via the **stretched-link pattern** — the focusable control is a real `<button>` (the metric) whose hit area covers the card, so the confidence meter and verdict badge keep their own semantics outside the button (a card-as-`<button>` would have swallowed the meter's role). Hover (`ink-tint-5`) + focus (`:focus-within` gold ring) + selected (`aria-pressed`); verdict distinguished by badge icon+label and signed delta (`data-dir`), never colour alone (NFR22).
- `PromiseTimeline` (`app-promise-timeline`): up to 8 quarter columns of stacked verdict segments; each column is a focusable filter/nav `<button>` (`aria-pressed`, `aria-label`), plus an "All quarters" reset. Empty quarters render an explicit muted baseline + `"<quarter>: no claims"` label. Legend lists all **5** verdict tones (incl. INSUFFICIENT_DATA). Direction is explicit (`DEFAULT_TIMELINE_DIRECTION = 'oldest-first'`, override via `direction` input); newest-first reverses display while `selectQuarter` still emits the stable source index.
- Responsive (AC3): shared `BREAKPOINTS` constant (`shared/layout/breakpoints.ts`) — mobile ≥320 / tablet 768–1279 / desktop ≥1280 — with CSS media queries keeping all 8 quarters legible and the card fluid on small screens (no horizontal page scroll). The full 3-pane page composition (timeline + detail + score together on desktop) is owned by Story 2.6; these are the component-level responsive specs it composes.
- Tests: 15 new (card: fields, badge icon+label, confidence present, real-button keyboard activation, aria-pressed, delta direction, delta omitted; timeline: default oldest-first order, newest-first reversal, empty-quarter, segment-per-claim, 5-tone legend, stable index emit, clear-filter). Full suite **52/52 green**; `ng lint` clean; `ng build` succeeds.

### Decisions
- Form: **card** (AC says "Claim Card"), applied consistently instead of the kit's table row.
- Timeline direction: **oldest-first** (FR31/FR33) — chronological left-to-right, matching the kit; exported as the documented default and overridable.
- Card output named `claimSelect` (not `select`, a native DOM event — lint `no-output-native`).
- `ClaimSummary.speaker` added to the presentation model; must be carried through on the Epic-5 claim DTO when 5.5 lands.

### File List
- frontend/src/app/shared/claim/claim.ts
- frontend/src/app/shared/layout/breakpoints.ts
- frontend/src/app/shared/claim-card/claim-card.component.ts
- frontend/src/app/shared/claim-card/claim-card.component.spec.ts
- frontend/src/app/shared/promise-timeline/promise-timeline.component.ts
- frontend/src/app/shared/promise-timeline/promise-timeline.component.spec.ts

## Change Log
- 2026-05-29: Story authored from the design-system gap analysis.
- 2026-05-29: Implemented ClaimCard (focusable, speaker + confidence) and PromiseTimeline (8-quarter, oldest-first, empty-quarter, filter) + shared breakpoints and tests. Suite 52/52, lint + build green. Status → review.
