# Story 2.5: Claim Detail Panel & Reasoning Trace Specs

Status: review

## Story

As the **frontend developer**,
I want the claim detail panel and reasoning trace specified and completed,
So that BullByte's primary trust mechanism — the full, auditable transparency view — is ready for Epic 6 (6.5, 6.6).

## Acceptance Criteria

1. **Given** the Claim Detail Panel
   **Then** it defines: raw quote, **speaker attribution**, source quarter, verdict badge, quantitative delta, confidence indicator, direct EDGAR filing link, and **share link** button (FR36, FR37, FR38, FR41, UX-DR3)

2. **Given** the Reasoning Trace
   **Then** it defines the ordered tool-call steps with step index, tool name, result summary, and an **inline EDGAR citation link per step** (FR39, UX-DR3)
   **And** the trace is **expandable — collapsed by default, expanded on user action**

3. **Given** a low-confidence verdict in the panel
   **Then** the confidence indicator is visually distinct (flagged, not hidden) (FR40, UX-DR5)
   **And** a brief note accompanies it ("Low confidence — review reasoning trace")

4. **Given** the EDGAR filing link
   **Then** it is an external link (opens new tab) with filing type and quarter in the link text (FR38)

## Gaps to close (this story)

- 🔴 **Speaker attribution** missing from the panel.
- 🔴 **Low-confidence flag + note** missing.
- 🔴 **Reasoning trace per-step inline EDGAR citation links** missing (results are plain text).
- 🔴 **Trace expand/collapse** missing (design renders it always-expanded; AC wants collapsed-by-default).
- 🟡 **Quote font conflict**: AC says monospace; design uses a serif pull-quote. Reconcile (recommend keeping serif and updating the AC).
- 🟡 **Share link**: design has "Copy citation"; add/clarify a share action for stable-URL sharing (FR41).

## Tasks / Subtasks

- [x] Task 1: `ClaimDetailPanel` — quote + speaker + source quarter + verdict + delta + confidence + EDGAR link + share (AC1, AC4)
- [x] Task 2: `ReasoningTrace` — ordered steps with per-step citation links; collapsed-by-default expand/collapse (AC2)
- [x] Task 3: Low-confidence flag treatment + note (AC3)
- [x] Task 4: Tests (expand/collapse; external link attrs; low-confidence flag)

## Dev Notes

- Visual reference: `ui_kits/dashboard/ClaimDetail.jsx` (verdict header, pull-quote, claimed→actual, trace), specimen `preview/reasoning-trace.html`.
- Trace step shape in the kit: `{ tool, args, result }` — extend with a citation/source per step to satisfy FR39. Align with the real reasoning-trace output when 4.5/5.5 land.

### References
- [Source: epics.md — Story 2.5]
- [Source: bullbyte-design-system/project/ui_kits/dashboard/ClaimDetail.jsx]

## Dev Agent Record
### Agent Model Used
claude-opus-4-8
### Completion Notes List
- `ClaimDetailPanel` (`app-claim-detail-panel`): verdict badge + delta header, metric·quarter meta, "The claim" serif pull-quote with **speaker attribution**, "What actually happened" claimed→actual, ConfidenceIndicator, and the embedded ReasoningTrace. Empty state when no claim selected. Reuses 2.2 `VerdictBadge`/`ConfidenceIndicator` and the 2.4 `ClaimSummary` (extended to `ClaimDetail`).
- EDGAR links (AC4): both the claim source and the actual source render as external `target="_blank" rel="noopener noreferrer"` links with **filing type + quarter** in the link text and an external-link glyph + visually-hidden "(opens in a new tab)".
- Share (AC1, FR41): a `Share` button emits a `share` output (claim id) and, when a `shareUrl` input is provided and the Clipboard API is available, copies the stable deep link and flips the label to "Link copied" — superseding the kit's "Copy citation".
- Low confidence (AC3): below `LOW_CONFIDENCE_THRESHOLD` (0.6) the ConfidenceIndicator shows its flagged treatment **and** a brief note "Low confidence — review reasoning trace" — flagged, never hidden.
- `ReasoningTrace` (`app-reasoning-trace`): ordered tool-call steps (index · tool · args · result), **collapsed by default**, expanded via a real toggle button (`aria-expanded`/`aria-controls`, keyboard-operable). Per-step **inline EDGAR citation link** (external, new tab) when a step has a `citation` (FR39). Distinct from the live run feed (2.3).
- Model: extended `shared/claim/claim.ts` with `ClaimDetail`, `FilingRef`, and `TraceStep` (incl. optional `citation`) — to align with the reasoning-trace output landing in 4.5 / 5.5.
- Tests: 10 new (trace collapse/expand + ordered steps + per-step citation external attrs; panel empty state, fields, external link type+quarter, embedded collapsed trace, share emit, low-confidence flag+note). Full suite **62/62 green**; `ng lint` clean; `ng build` succeeds.

### Decisions
- Quote font: **serif pull-quote** kept (matches the kit + the 2.4 card; mono is reserved for data/trace). The earlier "monospace" AC note is superseded — recorded here rather than re-litigated.
- Share action: a single **Share** (stable-URL copy, FR41) in place of the kit's "Copy citation".
- `TraceStep.citation` is optional — steps without a backing source render no link.

### File List
- frontend/src/app/shared/claim/claim.ts (added ClaimDetail, FilingRef, TraceStep)
- frontend/src/app/shared/reasoning-trace/reasoning-trace.component.ts
- frontend/src/app/shared/reasoning-trace/reasoning-trace.component.spec.ts
- frontend/src/app/shared/claim-detail-panel/claim-detail-panel.component.ts
- frontend/src/app/shared/claim-detail-panel/claim-detail-panel.component.spec.ts

## Change Log
- 2026-05-29: Story authored from the design-system gap analysis.
- 2026-05-29: Implemented ClaimDetailPanel (speaker, EDGAR links, share, low-confidence note) and ReasoningTrace (collapsed-by-default, per-step citations) + model extensions and tests. Suite 62/62, lint + build green. Status → review.
