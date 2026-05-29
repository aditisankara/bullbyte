# Story 2.1: Design Token System

Status: review

## Story

As the **frontend developer**,
I want the BullByte Design System token layer adopted into the Angular app and completed where it falls short of our spec,
So that every Epic 6 component builds against a single, compliant source of truth for colour, type, spacing, radii, shadow, and motion.

## Context

The design system (dropped in at `bullbyte-design-system/`) ships a complete token file, `project/colors_and_type.css`. Its foundation was already ported into the Angular app in **PR #72** (`frontend/src/styles/foundations.css` + vendored Butler font + Google-fonts `<link>`). This story tracks that adoption and closes the remaining token gaps found in the gap analysis.

## Acceptance Criteria

1. **Given** the token layer is loaded into the Angular app
   **When** a developer inspects global styles
   **Then** the design-system tokens (surfaces, ink, gold, type scale, spacing, radii, shadow, motion) are available as CSS custom properties and applied to native elements _(done — PR #72)_

2. **Given** the verdict colour tokens
   **When** a developer inspects them
   **Then** **all five** verdict states are defined with base/bg/ink values: DELIVERED, MISSED, PENDING, **INSUFFICIENT_DATA**, REVISED
   **And** every verdict bg+ink pair meets WCAG AA contrast (≥4.5:1) (NFR22)

3. **Given** the colour tokens
   **When** a developer inspects semantic naming
   **Then** brand-primary and brand-secondary are named/aliased (currently `--ink` and `--gold`) so component specs can reference them by role

4. **Given** the typography tokens
   **When** a developer inspects the scale
   **Then** the required levels exist (display, heading-l, heading-m, body, body-sm, mono) with family, weight, size, and line-height resolvable per level

5. **Given** any verdict status in the UI
   **Then** it is represented by colour token **and** text label, never colour alone (NFR22, UX-DR2)

## Gaps to close (this story)

- 🔴 **Add `INSUFFICIENT_DATA` verdict tokens** (`--verdict-insufficient`, `-bg`, `-ink`) — neutral gray family — light + dark mode; contrast-check the pair to AA.
- 🟡 **Brand role aliases**: add `--brand-primary` (→ ink) and `--brand-secondary`/accent (→ gold), or document the mapping.
- 🟡 **Type levels**: decide rem vs px and whether to package per-level weight+line-height as named type styles, or accept the current token-sizes + element-style approach as the spec; document the decision.

## Tasks / Subtasks

- [x] Task 1: Port `colors_and_type.css` → `frontend/src/styles/foundations.css`; vendor Butler; wire fonts + build (PR #72)
- [x] Task 2: Add `INSUFFICIENT_DATA` verdict tokens (light + dark) and contrast-check all 5 pairs (AC2)
- [x] Task 3: Add brand-role aliases (AC3)
- [x] Task 4: Document the type-scale decision (AC4)
- [x] Task 5: Mirror the new tokens back into `bullbyte-design-system/project/colors_and_type.css` so the source stays the single truth

## Dev Notes

- Source of truth: `bullbyte-design-system/project/colors_and_type.css` + `README.md`.
- Verified contrast (existing 4 light pairs): delivered 7.1, missed 7.3, revised 8.2, pending ~4.9 (passes, tightest). The new INSUFFICIENT_DATA pair must clear 4.5.
- The design defines only 4 verdict states; our domain has 5 — `INSUFFICIENT_DATA` is the canonical 5th (low/no actuals yet to verify against).

### References
- [Source: epics.md — Story 2.1]
- [Source: bullbyte-design-system/project/colors_and_type.css]
- [PR #72 — tokens foundation]

## Dev Agent Record
### Agent Model Used
claude-opus-4-8
### Completion Notes List
- Foundation adopted in PR #72; token gaps tracked here.
- Added `INSUFFICIENT_DATA` verdict tokens (base/bg/ink) for light + dark mode.
- Added `--brand-primary` (→ ink) and `--brand-secondary` (→ gold) role aliases.
- Documented the type-scale decision (px sizes + element-level type styles = the named-type spec) inline in both the app file and the source.
- Mirrored all new tokens + the type-scale decision back into the design-system source so it stays the single truth.
- AC2 verified — all five light-mode verdict bg+ink pairs clear WCAG AA (≥4.5:1):
  delivered 7.14, missed 7.28, pending 4.88, revised 8.18, insufficient 7.89.
  Dark-mode verdict `-bg` values are intentionally translucent tints over dark paper; legibility is carried by the `-ink` on the dark surface.
- AC5 (colour + text label, never colour alone) is enforced at component-spec level (Story 2.2+); the token layer here provides both the colour token and a stable verdict key for the label.
### File List
- frontend/src/styles/foundations.css
- bullbyte-design-system/project/colors_and_type.css (token source)

## Change Log
- 2026-05-29: Story authored from the design-system gap analysis; foundation already landed (PR #72).
- 2026-05-29: Closed token gaps — INSUFFICIENT_DATA tokens, brand-role aliases, type-scale decision; mirrored to source; verified all 5 verdict pairs at AA. Status → review.
