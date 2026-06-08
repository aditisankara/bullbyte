# Story 6.5: Claim Detail Panel Component

Status: review

## Story

As a **retail investor**,
I want to click any claim card and see the full detail — the exact quote, verdict, quantitative delta, confidence score, and a direct link to the source EDGAR filing,
So that I can verify BullByte's verdict against the primary source and judge for myself whether I agree.

## Acceptance Criteria

1. **Given** a user clicks or activates a claim card
   **When** the `ClaimDetailComponent` opens
   **Then** it fetches `GET /api/v1/claims/:claimId` and renders the raw quote, speaker attribution, source quarter, verdict badge, quantitative delta, confidence indicator, and EDGAR source link (FR36, FR37, FR38, UX-DR3)
   **And** the panel opens with no additional loading spinner beyond the initial card tap (NFR4)

2. **Given** the claim detail panel renders
   **When** a user inspects the EDGAR source link
   **Then** it opens in a new tab with the filing reference and quarter in the link text (FR38)

3. **Given** a claim whose detail response carries `lowConfidence: true`
   **When** the claim detail panel renders
   **Then** the confidence indicator is visually distinct from high-confidence verdicts (FR40, UX-DR5)
   **And** a brief note explains the low-confidence flag without hiding the verdict

4. **Given** a user activates the share button
   **When** it is triggered
   **Then** the current URL — including the selected claim in a URL parameter — is copied to the clipboard (FR41)
   **And** navigating directly to that URL renders the same claim detail view for any user

5. **Given** a user closes the claim detail panel via the Escape key
   **When** the panel closes
   **Then** focus returns to the claim card that opened it (NFR21)

## Tasks / Subtasks

- [x] Task 1: Typed claim-detail client + DTO mirror (AC1) — extend 6.3's claim models
  - [x] `core/api/claim.models.ts` — added `ReasoningTraceStepApi` (mirror `ReasoningTraceStepDto`) and `ClaimDetailApi` (mirror `ClaimDetailDto` = `ClaimListItem` + `{ edgarSourceUrl, lowConfidence, reasoningTrace }`). Reuses the existing `ClaimListItem` / `ClaimVerdictApi`. Named `*Api` to avoid clashing with the 2.5 presentation `ClaimDetail`.
  - [x] `core/api/company-api.service.ts` — added `getClaimDetail(claimId): Observable<ClaimDetailApi>` → `GET ${apiBaseUrl}/claims/:claimId` (**not** under `/companies`)
  - [x] Service spec: detail happy path (incl. `lowConfidence`)

- [x] Task 2: Reconcile the 2.5 `ClaimDetailPanel` with the real 5.5 API — opt-in inputs only (AC1–AC3)
  - [x] Added opt-in `showComparison` (default `true`) — set `false` to hide the "What actually happened" claimed→actual block when the API supplies no `actual` value. The quantitative outcome is still shown via the header **delta** (FR37). The confidence indicator + low-confidence note stay (they live in the same section but outside the gated block).
  - [x] Made the source filing link tolerant: renders only when `filing.url` is present, and labels with `filing.type || 'EDGAR filing'` when the type is absent (AC2, FR38).
  - [x] Confidence + low-note remain driven by the panel's `LOW_CONFIDENCE_THRESHOLD` (0.6), which agrees with the API `lowConfidence`.
  - [x] 2.5 spec stays green; added coverage for the opt-in + tolerant filing.

- [x] Task 3: `ClaimDetailComponent` — the smart panel (AC1–AC5)
  - [x] `features/company/claim-detail.component.ts` — input `claimId: string | null`; fetches `getClaimDetail` via an `effect`; 4-state `LoadState`. Null `claimId` → the panel's empty state, **no request**.
  - [x] NFR4: the last loaded detail is kept across selection changes, so a refetch never flashes the empty state; first load shows a quiet "Loading claim…" line (no spinner).
  - [x] Adapts `ClaimDetailApi` → the 2.5 `ClaimDetail` via `toClaimDetail` (claim-mapping); passes `showComparison: false`.
  - [x] Share (AC4): the absolute deep link is passed as `shareUrl`; the panel's own `share` output + clipboard copy handle it.
  - [x] Close (AC5): a `document:keydown.escape` host listener (guarded to fire only while open) and an explicit close control both emit `closed`; the page restores focus.
  - [x] Spec: fetch + render, no-fetch when null, generic filing label, low-confidence flag, inline error, close via control + Escape, Escape ignored when closed.

- [x] Task 4: Wire into the company page detail slot — URL selection + focus return (AC4, AC5)
  - [x] `features/company/company.component.ts` — the detail slot now hosts `<app-claim-detail [claimId]="selectedClaimId()" [shareUrl]="shareUrl()" (closed)="onCloseClaim()" />`.
  - [x] Selection promoted to the URL: added a `claim` input (the `?claim=` query param via `withComponentInputBinding`); `selectedClaimId` is now a `computed` off it (deep-linkable + shareable, AC4). `onSelectClaim` captures `document.activeElement` then navigates `?claim=` (merge); `onCloseClaim` clears it and `.focus()`es the captured card (AC5, NFR21).
  - [x] `shareUrl` = `location.origin + router.url` (the URL now carries `?claim=`).
  - [x] Spec: open writes `?claim=` + marks the card selected + fetches; direct `?claim=` deep link renders; no fetch when unselected; close + Escape clear `?claim=`.

- [x] Task 5: Verify — `ng test` 156/156, `ng lint` clean, `ng build` clean; no `api/` files touched

## Dev Notes

### API contract (from 5.5 — do not re-shape)
- `GET /api/v1/claims/:claimId` → `200 ClaimDetailDto` or `404 CLAIM_NOT_FOUND`. PostgreSQL only.
- `ClaimDetailDto` = `ClaimListItemDto` + `{ edgarSourceUrl: string | null, lowConfidence: boolean, reasoningTrace: ReasoningTraceStepDto[] }`.
- `verdict: ClaimVerdictDto | null` — null while pending; `verdict.delta` is the quantitative delta; `confidenceScore` 0–1 or null.
- `lowConfidence` is a top-level flag; the verdict is never withheld (AC3 structural). `reasoningTrace[].toolCall` is opaque jsonb.

### The 5.5 ⇄ 2.5 model mismatch (the heart of this story)
The 2.5 `ClaimDetailPanel` was designed richer than 5.5 returns. This story is the adapter (`toClaimDetail` in `claim-mapping.ts`) — it does not rebuild the panel:

| 2.5 `ClaimDetail` (panel needs) | 5.5 `ClaimDetailDto`              | Bridge                                           |
| ------------------------------- | --------------------------------- | ------------------------------------------------ |
| `verdict: Verdict` (incl PENDING) | `verdict \| null` (no PENDING)    | `null → 'PENDING'` (via `toClaimSummary`)        |
| `delta?`                        | `verdict.delta`                   | direct (FR37)                                    |
| `quarter` `"Q1 2024"`           | `quarter` `"Q3-2024"`             | dash → space                                     |
| `quote` / `speaker` / `confidence` | `rawQuote` / `speaker` / scores  | via `toClaimSummary`                             |
| `claimed`                       | `targetValue` (+ `targetUnit`)    | composed                                         |
| `actual`                        | — **not returned**                | `''`; comparison hidden (`showComparison:false`) |
| `filing.{url,quarter}`          | `edgarSourceUrl`, `quarter`       | direct; no url → no source link                  |
| `filing.type`                   | — **not returned**                | generic "EDGAR filing" label                     |
| `actualFiling`                  | — **not returned**                | empty; hidden with the comparison block          |
| `trace: TraceStep[]`            | `reasoningTrace[]` (opaque `toolCall`) | basic map; full citations are **6.6**       |

### Gaps where 5.5 under-serves the design (decisions)
- **No `actual` / `actualFiling`.** 5.5 returns the claim target + the verdict delta, not a clean "actual" number or a second filing. The 6.5 ACs ask for the **delta** (present), not the claimed→actual pair, so the comparison is gated off rather than faked. A later API change that adds `actualValue` + `actualFiling` flips `showComparison` back on.
- **No filing `type`** on `edgarSourceUrl` — the link degrades to a generic "EDGAR filing · {quarter}" rather than asserting an 8-K the API didn't return. Candidate 5.5 follow-up: add `filingType` to the detail DTO.

### Selection, deep-linking, focus (AC4/AC5) — built on 6.3's seam
6.3 left a `selectedClaimId` signal set on card activation, with the detail slot a placeholder. 6.5 promotes selection to the `?claim=` URL param (mirroring 6.3's `?quarter=` filter), so the open panel **is** the URL — deep-linkable and shareable for free, and decoupled from the card internals. Card activation navigates `?claim=` after capturing `document.activeElement`; close clears the param and refocuses that element (`activeElement`, so it needs nothing card-specific).

### Boundary with 6.6 (reasoning trace)
The panel embeds the `ReasoningTrace` collapsed. 6.5 maps steps minimally (`resultSummary → result`, `edgarFilingRef → citation`, a best-effort tool label from the opaque `toolCall`). The structured `toolCall` parsing, per-step inline citations (filing type/ticker/quarter), and the INSUFFICIENT_DATA final step are **6.6**.

### NFR4 — no extra spinner
Detail is cached (5.5, no FastAPI hop). The smart component keeps the prior panel visible across refetches; first load shows a quiet "Loading claim…" line, never a spinner.

### What this story does NOT do
- No claim list / timeline / cards — 6.3 owns those and the selection trigger.
- No reasoning-trace deepening — 6.6.
- No `claimed → actual` comparison — 5.5 returns no `actual` (gated off; delta carries the outcome).
- No API changes — 5.5 already serves `GET /claims/:claimId`.

### References
- [Source: epics.md — Story 6.5]
- [Source: api/src/claims/dto/claim-detail.dto.ts; claim-list.dto.ts; claim-verdict.dto.ts — 5.5 wire contract]
- [Source: frontend/src/app/shared/claim-detail-panel/claim-detail-panel.component.ts — 2.5 presentational panel]
- [Source: frontend/src/app/shared/claim/claim.ts — 2.5 ClaimDetail/FilingRef/TraceStep model]
- [Source: frontend/src/app/features/company/claim-mapping.ts — 6.3 adapter seam, extended with toClaimDetail]
- [Source: frontend/src/app/features/company/company.component.ts — 6.1/6.2/6.3/6.4 integration point]

## Dev Agent Record
### Agent Model Used
claude-opus-4-8 (story draft + implementation)
### Completion Notes List
- **Pre-req: repaired a broken `main` first.** The 6.3↔6.4 merge (`7bbabed`) had landed a non-compiling `company-api.service.ts` (+ a dropped `ScoreCardComponent` import and two mangled spec files). Fixed via a separate hotfix PR (#96, merged) before this story; the 6.5 worktree was rebased onto the repaired `main`. 6.5 itself touches none of that beyond extending the now-correct files.
- Developed in an isolated worktree off the repaired `origin/main`; frontend-only (5.5 already serves `/claims/:id`), zero `api/` files touched.
- The core is the 5.5⇄2.5 adapter (`toClaimDetail`) plus three opt-in degradations on the 2.5 panel (`showComparison=false`, tolerant source filing). All prior 2.5 specs stay green.
- Selection is URL-driven (`?claim=`), promoting 6.3's `selectedClaimId` signal to a computed off the param — AC4 deep-link/share is structural, and focus-return (AC5) uses the captured `document.activeElement`, so it's card-agnostic.
- Suites: frontend **156/156** (new: 1 api-service spec, 6 mapping specs, 3 panel specs, 8 smart-component specs, 5 company-page specs); `ng lint` clean; `ng build` clean.
### File List
- _bmad-output/implementation-artifacts/6-5-claim-detail-panel-component.md
- _bmad-output/implementation-artifacts/sprint-status.yaml (6-5 → review)
- frontend/src/app/core/api/claim.models.ts (ReasoningTraceStepApi + ClaimDetailApi)
- frontend/src/app/core/api/company-api.service.ts (getClaimDetail)
- frontend/src/app/core/api/company-api.service.spec.ts (detail spec)
- frontend/src/app/features/company/claim-mapping.ts (toClaimDetail + helpers)
- frontend/src/app/features/company/claim-mapping.spec.ts (toClaimDetail specs)
- frontend/src/app/shared/claim-detail-panel/claim-detail-panel.component.ts (showComparison + tolerant filing)
- frontend/src/app/shared/claim-detail-panel/claim-detail-panel.component.spec.ts (opt-in specs)
- frontend/src/app/features/company/claim-detail.component.ts (new — smart panel)
- frontend/src/app/features/company/claim-detail.component.spec.ts (new)
- frontend/src/app/features/company/company.component.ts (detail slot + URL selection + focus)
- frontend/src/app/features/company/company.component.spec.ts (selection + detail specs)

## Change Log
- 2026-06-08: Story drafted from epics.md §6.5, grounded against 5.5 + the 2.5 panel + 6.3's claim models. Status: ready-for-dev.
- 2026-06-08: Implemented off the repaired main (after hotfix #96) — claim-detail client, the 5.5⇄2.5 adapter, the smart panel with URL-driven selection + Escape/close + focus return. Frontend 156/156, lint + build clean. Status: review.
