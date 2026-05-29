# Epic 2 — Component Spec Matrix (capstone, Story 2.6 AC5)

The written state / token / responsive spec for every component built in Epic 2.
All components are standalone, `OnPush`, signal `input()`/`output()`, live under
`frontend/src/app/shared/`, and consume the Story 2.1 tokens via `var(--…)`.
Breakpoints reference `shared/layout/breakpoints.ts`: **mobile ≥320 · tablet
768–1279 · desktop ≥1280** (NFR23, UX-DR8).

Legend for responsive: *fluid* = no fixed width, `min-width:0`, wraps; *fixed*
= intentional fixed size (e.g. the 140px score ring, 18px glyphs).

---

## 2.1 — Token layer (`styles/foundations.css`)
- **States:** n/a (tokens). Light + dark via `[data-theme="dark"]`.
- **Tokens:** the source of truth — surfaces, ink, gold, 5 verdict triples (incl. `--verdict-insufficient*`), type scale, spacing, radii, shadow, motion, layout. Brand aliases `--brand-primary`/`--brand-secondary`.
- **Responsive:** 16px root keeps the px scale zoom-friendly. **A11y:** all 5 verdict bg/ink pairs ≥ WCAG AA.

## 2.2 — VerdictBadge (`app-verdict-badge`)
- **States:** 5 verdicts (DELIVERED, MISSED, PENDING, INSUFFICIENT_DATA, REVISED) × size `sm`/`md`.
- **Tokens:** `--verdict-<token>-bg/-ink`, `--font-sans`, `--radius-sm`, `--space-1`.
- **Responsive:** inline, `white-space:nowrap`; scales with type. **A11y:** icon `aria-hidden`; text label always present (colour never alone, UX-DR2/NFR22).

## 2.2 — ConfidenceIndicator (`app-confidence-indicator`)
- **States:** normal vs **low** (< `LOW_CONFIDENCE_THRESHOLD` = 0.6) → amber fill + "Low confidence" flag; score clamped 0–1.
- **Tokens:** `--ink-3`, `--ink-tint-10`, `--verdict-pending(-ink)`, `--radius-full`, `--text-xs`.
- **Responsive:** inline-flex, fixed 64px track. **A11y:** `role="meter"` + `aria-valuemin/max/now`; flagged-not-suppressed (FR40, UX-DR5).

## 2.2 — DisclaimerFooter (`app-disclaimer-footer`)
- **States:** single (static). Canonical `DISCLAIMER_TEXT` ("…via EDGAR").
- **Tokens:** `--rule`, `--ink-3/-4`, `--text-xs`, `--max-w`, `--gutter`, `--space-5/10`.
- **Responsive:** flex wrap, centered to `--max-w`. **A11y:** semantic `<footer>` (FR44, UX-DR10).

## 2.2 — ErrorState (`app-error-state`)
- **States:** ticker-not-found / edgar-unavailable / analysis-timeout (retryable, emit `retry`) · low-confidence (non-retryable). Optional `heading`/`body`/`context` overrides.
- **Tokens:** `--ink-2/-3/-4`, `--ink`/`--paper` (button), `--radius-sm`, `--space-*`.
- **Responsive:** centered column, `max-width:420px`. **A11y:** `role="alert"` for failures, `role="status"` for low-confidence; real `<button>` retry (UX-DR6, NFR6).

## 2.3 — SearchInput (`app-search-input`)
- **States (loading union):** idle / loading (spinner, `aria-busy`, disabled) / success (confirmation) / error (embedded ErrorState `ticker-not-found`). Emits `tickerSearch` (trimmed+uppercased).
- **Tokens:** `--paper-2`/`--paper`, `--rule`/`--ink` (focus border), `--font-sans`/`--font-mono`, `--radius-sm`, `--text-sm`.
- **Responsive:** `max-width:480px`, fluid input (`min-width:0`). **A11y:** `role="search"`, visible AA focus (global gold + `:focus-within`), Tab/Enter operable (UX-DR7, NFR21).

## 2.3 — AnalysisProgressFeed (`app-analysis-progress-feed`)
- **States (per step):** completed (check) · failed (slash) · in-progress (pulsing dot, synthetic trailing row while live). Append-only.
- **Tokens:** `--rule`, `--verdict-delivered/-missed(-ink)`, `--gold`/`--gold-tint`, `--font-mono`, `--text-sm`.
- **Responsive:** `max-width:640px`, fluid. **A11y:** `role="log"` `aria-live="polite"` `aria-relevant="additions"` (NFR5, UX-DR1); pulse honours `prefers-reduced-motion`.

## 2.4 — ClaimCard (`app-claim-card`)
- **States:** default / hover (`ink-tint-5`) / focus (`:focus-within` gold ring) / selected (`aria-pressed`). Delta direction up/flat/down. Emits `claimSelect`.
- **Tokens:** `--paper`, `--rule`/`--ink`, `--radius-md`, `--font-serif` (quote), verdict colours via badge.
- **Responsive:** fluid card; footer wraps; reduced padding < 768. **A11y:** stretched-link real `<button>` keeps the confidence meter's semantics; verdict distinct by badge icon+label & delta, not colour (NFR22, UX-DR7).

## 2.4 — PromiseTimeline (`app-promise-timeline`)
- **States:** quarter selected / unselected; **empty quarter** (baseline + "no claims"); "All quarters" filter active. Direction `oldest-first` (default) / `newest-first`. Emits `selectQuarter` (stable source index).
- **Tokens:** `--verdict-<token>`, `--ink-tint-5/10`, `--rule(-strong)`, `--radius-sm`, `--space-*`.
- **Responsive:** 8-col grid; gaps/label size shrink < 768 to stay legible with no horizontal page scroll. **A11y:** each column a `<button>` with `aria-pressed` + descriptive `aria-label`; 5-tone legend.

## 2.5 — ClaimDetailPanel (`app-claim-detail-panel`)
- **States:** populated / empty ("Select a claim…"); low-confidence note when < 0.6; share → "Link copied". Emits `share`.
- **Tokens:** `--rule`, `--paper`, `--font-serif` (quote), `--font-mono` (values), `--verdict-pending-ink` (low note), `--space-*`.
- **Responsive:** claimed→actual row wraps; padding reduces < 768. **A11y:** EDGAR links `target=_blank rel="noopener noreferrer"` + "(opens in a new tab)"; verdict via badge (FR36–FR41, UX-DR3).

## 2.5 — ReasoningTrace (`app-reasoning-trace`)
- **States:** collapsed (default) / expanded; per-step optional citation link.
- **Tokens:** `--paper-2`, `--gold-2` (tool), `--ink-3` (args), `--verdict-delivered` (result), `--font-mono`, `--text-xs`.
- **Responsive:** fluid; mono wraps. **A11y:** toggle `<button>` with `aria-expanded`/`aria-controls`; citation links external/new-tab; chevron honours `prefers-reduced-motion` (FR39, UX-DR3).

## 2.6 — CeoScoreCard (`app-ceo-score-card`)
- **States:** populated / null (renders nothing); trend up/flat/down; zero-resolved → "no resolved promises yet". Score clamped 0–10.
- **Tokens:** `--gold` (arc), `--rule` (track), `--font-serif` (number), `--verdict-<token>` (stats), `--ease-out`, `--space-*`.
- **Responsive:** ring fixed 140px; meta fluid; gap reduces < 768. **A11y:** ring `role="img"` with score label; arc transition honours `prefers-reduced-motion`. Sample-size context always present — never a bare fraction (FR22–FR24, FR23, UX-DR4).

## 2.6 — CompanyPageLayout (`app-company-page-layout`)
- **States:** structural blueprint (4 projected slots: score / timeline / claims / detail).
- **Tokens:** `--max-w`, `--gutter`, `--space-7`, `--rule`, `--nav-h` (sticky offset) — spacing/gutters via tokens only, no fixed widths.
- **Responsive:** mobile/tablet single column (detail inline below claims); **desktop ≥1280** two-column body (claims `1.1fr` + sticky detail `1fr`) under full-width score + timeline → all three panels visible together. `min-width:0` on every region prevents horizontal overflow at 320px (AC2–AC4, NFR23).

---

### Responsive verification (Task 4)
Breakpoint behaviour is implemented in component CSS against the shared
`BREAKPOINTS` values (no fixed widths, `min-width:0`, flex-wrap, contained
grids). `ng build` is clean. Pixel-level visual confirmation at 320 / 768 /
1280+ in a real browser is performed when these components are mounted in
Epic 6 (no browser harness in the unit-test setup); the CSS here is written to
guarantee no horizontal page overflow and simultaneous desktop panels.
