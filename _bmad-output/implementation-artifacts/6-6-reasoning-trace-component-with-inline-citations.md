# Story 6.6: Reasoning Trace Component with Inline Citations

Status: review

## Story

As a **finance student**,
I want to expand the reasoning trace on any claim and see every tool call BullByte made — including inline citations linking to the exact EDGAR filings it used,
So that I can cite the primary source documents in my research rather than citing BullByte itself.

## Acceptance Criteria

1. **Given** the claim detail panel is open
   **When** a user activates the "Show reasoning trace" toggle
   **Then** the `ReasoningTraceComponent` expands and renders the ordered list of tool-call steps (FR39)
   **And** it is collapsed by default — the toggle is the only way to expand it

2. **Given** the reasoning trace is expanded
   **When** a user reads a step that references an EDGAR filing
   **Then** the step includes an inline citation link showing the filing type, ticker, and quarter (FR39, UX-DR3)
   **And** clicking the link opens the EDGAR filing in a new tab

3. **Given** the reasoning trace renders
   **When** all steps are displayed
   **Then** they appear in correct `stepIndex` order with no truncation
   **And** each step is visually distinct from adjacent steps

4. **Given** a claim with verdict `INSUFFICIENT_DATA`
   **When** the reasoning trace is expanded
   **Then** the final step shows the failure reason as a structured step entry
   **And** the trace always ends at the failure point — no steps are missing

## Tasks / Subtasks

- [x] Task 1: Structured trace-step mapping — replaced 6.5's placeholder `toTraceStep` (AC1–AC3)
  - [x] `features/company/claim-mapping.ts` — parses the real 4.5 shapes:
    - **`toolCall`** `{ action, ...scalarArgs }` → `tool` = humanised `action` (curated labels for the five known verification actions; generic title-case otherwise); `args` = remaining scalar fields as `key=value` (skips `action` + nested values).
    - **`edgarFilingRef`** = `"{filingType} | {ticker} | {quarter} | {url}"` → split on `" | "`; 4 parts → `citation { label: "{type} · {ticker} · {quarter}", url }` (quarter via `displayQuarter`); null/malformed/url-less → **no citation** (never a broken href). **Corrects 6.5's placeholder**, which used the whole `edgarFilingRef` as the link url.
    - `result` = `resultSummary ?? ''`.
  - [x] Order preserved 1:1 (5.5 already returns `stepIndex` asc); no filtering/truncation (AC3).
  - [x] Unit tests: action→label, args join, valid/malformed/null citation, generic fallback, order preserved.

- [x] Task 2: Failure-step treatment for INSUFFICIENT_DATA (AC4) — via the data model, no new panel inputs
  - [x] `shared/claim/claim.ts` — added optional `failure?: boolean` to `TraceStep` (default absent → unchanged 2.5 behaviour).
  - [x] `claim-mapping.ts` — when the effective verdict is `INSUFFICIENT_DATA`, the **last** trace step is marked `failure: true` (the verifier accumulates each step and writes on failure, so the last step is the stop point).
  - [x] `shared/reasoning-trace/reasoning-trace.component.ts` — a `failure` step renders distinctly (left rule in the insufficient-data tone + a "trace ended here" tag); the failure reason stays visible as the step `result`. Toggle/collapse + citation rendering unchanged.

- [x] Task 3: Panel wiring carries the richer steps (AC1, AC2) — no structural change
  - [x] The 2.5 `ClaimDetailPanel` already embeds `<app-reasoning-trace [steps]="c.trace">`, fed by 6.5's smart `ClaimDetailComponent` via `toClaimDetail`; the richer mapping flows through.
  - [x] End-to-end spec on the smart component: collapsed by default → expand → inline `type · ticker · quarter` citation (external/new-tab) + the flagged INSUFFICIENT_DATA failure step.

- [x] Task 4: Verify — `ng test` 164/164, `ng lint` clean, `ng build` clean; no `api/` files touched

## Dev Notes

### The real 4.5/5.5 data shapes (the heart of this story)
5.5 passes the trace rows through verbatim (`api/src/claims/claims.service.ts:162`), so the shapes are exactly what the 4.5 logger writes (`ml-sidecar/src/services/verification_service.py`):

- **`toolCall`** (jsonb): `{ "action": "temporal_alignment" | "fetch_financial_actuals" | "llm_verdict" | "unit_conflict" | "unit_normalization", …scalar args }`. `action` is the tool name; the rest are args.
- **`resultSummary`**: a human-readable line (e.g. `"Aligned Q1-2024 → Q4-2024 (EXACT, 0.95): …"`).
- **`edgarFilingRef`**: `_make_filing_ref()` output — the pipe-delimited string `"{filing_type} | {ticker} | {quarter} | {url}"`, or `null` when there is no filing url. This is the source of FR39's "filing type, ticker, and quarter" — it is **not** a bare url.
- `stepIndex` is 1-based; 5.5 orders `asc(stepIndex), asc(createdAt)` — rendered as received (AC3).

### Why the final step is the failure step (AC4)
The verifier accumulates `_traces` step-by-step and, on any failure, calls `_insufficient_data(traces=_traces)` which writes everything accumulated — so the **last** written step is the stop point and its `result_summary` carries the reason (`"Alignment failed: …"`, `"Financials unavailable: …"`, `"Unit conflict: …"`). Flagging the last step `failure` when the verdict is `INSUFFICIENT_DATA` is therefore correct and needs no extra API field. DELIVERED/MISSED/PENDING/REVISED traces have no failure step.

### Brittle coupling flagged
Parsing `edgarFilingRef` depends on the 4.5 `" | "` delimiter. A structured field (`{ filingType, ticker, quarter, url }`) on `ReasoningTraceStepDto` would be more robust — candidate 5.5/4.5 follow-up. Until then the parser degrades safely (malformed → no citation).

### What 6.5 already built (not rebuilt)
- The 2.5 `ReasoningTraceComponent` provides the collapsed-by-default toggle (AC1), ordered index/tool/args/result rows, and the per-step external citation link (AC2 mechanics). 6.6 supplies the content (structured mapping) + the failure treatment.
- 6.5's smart `ClaimDetailComponent` embeds the trace via the panel and feeds `toClaimDetail`. 6.6 only deepens `toTraceStep` + adds the failure flag; selection/share/focus/panel-shell untouched.

### What this story does NOT do
- No changes to selection, the panel shell, share, or focus (6.5 owns those).
- No new API fields — the trace is already served by 5.5; the work is presentation-side parsing.
- No live run feed — that is the SSE progress feed (2.3 / 6.2), a different surface.

### References
- [Source: epics.md — Story 6.6]
- [Source: ml-sidecar/src/services/verification_service.py — `_traces` shapes, `_make_filing_ref`, `_insufficient_data`]
- [Source: api/src/claims/claims.service.ts:162; dto/claim-detail.dto.ts — ReasoningTraceStepDto]
- [Source: frontend/src/app/shared/reasoning-trace/reasoning-trace.component.ts — 2.5 trace component]
- [Source: frontend/src/app/features/company/claim-mapping.ts — 6.5 toTraceStep, replaced here]

## Dev Agent Record
### Agent Model Used
claude-opus-4-8 (story draft + implementation)
### Completion Notes List
- Developed in an isolated worktree off `origin/main` (4071d17, with 6.5 merged); frontend-only, zero `api/` files touched.
- The core is a structured replacement of 6.5's placeholder `toTraceStep`: `toolCall.action` → humanised tool label, scalar args → `key=value`, and the pipe-delimited `edgarFilingRef` parsed into a `type · ticker · quarter` citation. This also **fixes a latent 6.5 bug** — 6.5 used the whole `edgarFilingRef` string as the citation href, which would have been a broken link once a trace was expanded.
- AC4 handled through the data model (a new optional `TraceStep.failure`) rather than threading a new input through the panel: the last step is flagged when the verdict is INSUFFICIENT_DATA, and the 2.5 trace component renders it distinctly. Keeps the panel embedding untouched.
- Suites: frontend **164/164** (8 new mapping specs, 1 trace-component spec, 1 end-to-end smart-component spec); `ng lint` clean; `ng build` clean. All prior 2.5/6.5 specs stay green (the `failure` flag + structured parse are additive).
### File List
- _bmad-output/implementation-artifacts/6-6-reasoning-trace-component-with-inline-citations.md
- _bmad-output/implementation-artifacts/sprint-status.yaml (6-6 → review)
- frontend/src/app/shared/claim/claim.ts (TraceStep.failure)
- frontend/src/app/features/company/claim-mapping.ts (structured parseToolCall/parseCitation/toTraceStep + failure flag)
- frontend/src/app/features/company/claim-mapping.spec.ts (structured-parse + failure specs)
- frontend/src/app/shared/reasoning-trace/reasoning-trace.component.ts (failure-step rendering)
- frontend/src/app/shared/reasoning-trace/reasoning-trace.component.spec.ts (failure-step spec)
- frontend/src/app/features/company/claim-detail.component.spec.ts (end-to-end trace spec)

## Change Log
- 2026-06-08: Story drafted from epics.md §6.6, grounded against the real 4.5 trace shapes. Status: ready-for-dev.
- 2026-06-08: Implemented off main (6.5 merged) — structured trace mapping, FR39 citation parse, INSUFFICIENT_DATA failure step; corrected 6.5's placeholder citation. Frontend 164/164, lint + build clean. Status: review.
