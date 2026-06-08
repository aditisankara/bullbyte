# Story 6.7: Shareable URLs, Deep Linking & Accessibility Audit

Status: review

## Story

As a **developer**,
I want all ticker and claim views to have stable shareable URLs and the full application to pass a baseline accessibility check,
So that BullByte is demo-ready with every view linkable and meets the accessibility standards defined in the PRD. This story caps Epic 6.

## Acceptance Criteria

1. **Given** a user navigates to `/company/TSLA`
   **When** the company page loads
   **Then** it renders correctly with no 404 or redirect — the URL is stable and shareable (FR29)
   **And** refreshing the page renders the same content without requiring a new search

2. **Given** a user shares a URL with claim detail state in URL params (`/company/TSLA?claim=<id>`)
   **When** another user navigates to that URL
   **Then** `/company/TSLA` loads and the correct claim detail panel opens automatically (FR41)
   **And** the shared URL works without authentication (FR30)

3. **Given** the complete application
   **When** a developer runs a keyboard-navigation test
   **Then** every interactive element is reachable via Tab and operable via keyboard alone (NFR21, UX-DR7)
   **And** visible focus indicators are present on all focused elements

4. **Given** the complete application
   **When** a developer audits semantic HTML
   **Then** every page uses correct landmark regions (`<header>`, `<main>`, `<footer>`), a single `<h1>`, and a logical heading hierarchy with no skipped levels (NFR20)
   **And** all icons have appropriate `aria-label`/`aria-hidden` attributes

5. **Given** the application renders on a 320px viewport
   **When** every page and component is inspected
   **Then** no content causes horizontal overflow and all text is legible without pinch-zoom (NFR23)

## Tasks / Subtasks

- [x] Task 1: Shareable-URL + deep-link verification (AC1, AC2) — assertions over existing behaviour
  - [x] Direct load of `/company/TSLA` renders the dashboard (no redirect) and `/company/TSLA?claim=<id>` opens the panel automatically — already covered by the 6.1 direct-load specs and the 6.5 deep-link spec; left intact and relied on.
  - [x] FR30: no auth header is attached anywhere (the `httpErrorInterceptor` adds none) — structural, no code change.

- [x] Task 2: Skip-link + landmark consolidation (AC4)
  - [x] App shell (`app.html`/`app.scss`): a "Skip to content" link (off-screen until focused) targeting `<main id="main-content" tabindex="-1">`.
  - [x] Search page: the hero title + tagline are wrapped in a `<header>` landmark, so `/` exposes `<header>`/`<main>`/`<footer>` (company page already had `<header>`).
  - [x] Specs: skip-link present + precedes/targets main; both pages render one `<h1>` + a `<header>`; main + footer landmarks present.

- [x] Task 3: Heading-hierarchy fix (AC4)
  - [x] `ClaimDetailPanel` (2.5) — the `<h6 class="panel__label">` labels ("The claim" / "What actually happened") are now non-heading `<p>` captions (styled as the design-system uppercase eyebrow), so the panel no longer jumps from the page's h2/h3 to h6.
  - [x] Spec: the panel contains no `h4/h5/h6`; an integrated company-page spec asserts a single `<h1>` and no `h4/h5/h6` with the detail open.

- [x] Task 4: Keyboard + focus audit (AC3) — no fixes required
  - [x] Confirmed a global `:focus-visible` ring (`styles/foundations.css:363` — 2px gold, AA) applies to every focusable element. The only two `outline: none` rules (search input, claim-card button) each have a bespoke visible replacement (the field's border/background change; the card's `:focus-within` gold outline). Every control is a real `<button>`/`<a>`/`<input>` — Tab-reachable and keyboard-operable. The 6.5 Escape→focus-return path is spec-covered.

- [x] Task 5: Icon `aria` + 320px overflow audit (AC4, AC5)
  - [x] Icon sweep: every inline `<svg>` already carries `aria-hidden="true"` (verified by search) — none convey meaning alone; no change needed.
  - [x] 320px hardening: `overflow-wrap: anywhere` on the reasoning-trace body (dense mono args/result), the panel quote, and the company-header name; `min-width: 0` on the trace body. The layout was already token-based with `min-width: 0` on flex/grid regions (2.6).

- [x] Task 6: Verify — `ng test` 169/169, `ng lint` clean, `ng build` clean. **Live keyboard + 320px visual pass is still pending** (no browser harness in the unit setup — see Dev Notes).

## Dev Notes

### This was a consolidation/audit story — small, surgical diff
The hard mechanics (routing, query-param deep links, focus return, footer, single-h1, external-link safety, the global focus ring) were built across 6.1–6.6. The only real structural fix was the panel heading-level jump; everything else was a landmark/skip-link add and defensive 320px CSS.

### What was already correct (verified, not rebuilt)
- **FR29/FR41/FR30**: `/company/:ticker` is a real route via `withComponentInputBinding`; `selectedClaimId` is a computed off `?claim=` (6.5) and the detail fetches `/claims/:id` from that id alone, so a shared `?claim=` link opens the right panel on first paint. The `**` route only catches unknown paths. No auth layer exists.
- **AC3 focus**: global `:focus-visible` gold ring covers everything; the two `outline:none` cases have visible replacements. No interactive element is a click-only `div`.
- **AC4 icons**: all SVGs are `aria-hidden` (decorative); verdict state is conveyed by colour **and** label (NFR22), confidence by a `role="meter"`.

### The one real structural fix — heading hierarchy
`ClaimDetailPanel` used `<h6>` for section labels, which under the page's h1→h2(sections)→h3(cards) outline skipped h4/h5. "The claim" / "What actually happened" are field captions, not document headings, so they became `<p>` captions — removing the violation without changing the visual or inventing panel-level headings.

### Testing reality (recorded honestly)
The unit setup is vitest + jsdom — no real layout/paint — so **320px-overflow and pixel-level focus rings cannot be asserted programmatically** (the same constraint 2.6 recorded). What *is* unit-tested: landmarks, skip-link presence/target/order, single `<h1>`, absence of skipped heading levels, footer text, real button/anchor semantics, external-link `rel`/`target`. The CSS guarantees (token spacing, `min-width:0`, `overflow-wrap`) make 320px overflow structurally unlikely, but a **live keyboard walk-through and a 320px visual check in a browser remain a manual step** — not performed in this implementation. Recommended before the demo.

### What this story does NOT do
- No new data, endpoints, or panels.
- No auth (FR30 is "works without auth").
- No redesign — a11y fixes preserve the existing visual treatment.

### References
- [Source: epics.md — Story 6.7]
- [Source: frontend/src/app/app.html; app.scss; app.routes.ts — shell landmarks + skip-link]
- [Source: frontend/src/styles/foundations.css:363 — global :focus-visible ring]
- [Source: frontend/src/app/shared/claim-detail-panel/claim-detail-panel.component.ts — h6→caption fix]
- [Source: frontend/src/app/features/search/search.component.ts — hero header landmark]

## Dev Agent Record
### Agent Model Used
claude-opus-4-8 (story draft + implementation)
### Completion Notes List
- Developed in an isolated worktree off `origin/main` (5018ff7, Epic 6 through 6.6 merged); frontend-only, zero `api/` files touched.
- The audit found the codebase already in good a11y shape: a global `:focus-visible` ring, universal `aria-hidden` on decorative SVGs, real semantic controls, and the FR29/FR41/FR30 URL/deep-link/no-auth behaviour all already present. The substantive changes were the keyboard skip-link, the search-page `<header>` landmark, and the **one real defect** — the `ClaimDetailPanel`'s `<h6>` labels skipping heading levels, now non-heading captions.
- 320px hardening added `overflow-wrap`/`min-width:0` to the dense mono trace text, the panel quote, and the company-header name.
- **Honest gap**: the live keyboard walk-through + 320px visual confirmation were not run (no browser harness in the unit setup). Structural a11y is unit-tested; the visual/keyboard pass is recommended as a manual step before the demo.
- Suites: frontend **169/169** (new: 2 app-shell specs, 1 search-header spec, 1 panel heading-hierarchy spec, 1 integrated company-page heading spec); `ng lint` clean; `ng build` clean. All prior specs green.
### File List
- _bmad-output/implementation-artifacts/6-7-shareable-urls-deep-linking-and-accessibility-audit.md
- _bmad-output/implementation-artifacts/sprint-status.yaml (6-7 → review)
- frontend/src/app/app.html (skip-link + main#main-content)
- frontend/src/app/app.scss (skip-link styles)
- frontend/src/app/app.spec.ts (skip-link + landmark specs)
- frontend/src/app/features/search/search.component.ts (hero <header> landmark)
- frontend/src/app/features/search/search.component.spec.ts (header spec)
- frontend/src/app/shared/claim-detail-panel/claim-detail-panel.component.ts (h6→caption + quote overflow-wrap)
- frontend/src/app/shared/claim-detail-panel/claim-detail-panel.component.spec.ts (heading-hierarchy spec)
- frontend/src/app/shared/reasoning-trace/reasoning-trace.component.ts (trace body overflow-wrap)
- frontend/src/app/features/company/company.component.ts (header-name overflow-wrap)
- frontend/src/app/features/company/company.component.spec.ts (integrated heading spec)

## Change Log
- 2026-06-08: Story drafted from epics.md §6.7. Status: ready-for-dev.
- 2026-06-08: Implemented — skip-link + landmarks, search-page header, the claim-detail heading-hierarchy fix, 320px overflow hardening; confirmed the existing focus ring / icon-aria / URL-deep-link behaviour. Frontend 169/169, lint + build clean. Live keyboard/320px visual pass still pending. Caps Epic 6. Status: review.
