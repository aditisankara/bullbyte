---
created: 2026-05-01
supersedes: "epics.md (Epics 3, 4, 5, 6 only — Epic 1 foundation and Epic 2 design slice remain authoritative in epics.md)"
team_size: 2
phase_scope: phase-1
input_documents:
  - _bmad-output/planning-artifacts/prd.md
  - _bmad-output/planning-artifacts/epics.md
  - _bmad-output/planning-artifacts/architecture.md
  - _bmad-output/planning-artifacts/dev-plan.md
---

# BullByte — Vertical Slice Plan (Phase 1)

## Why this document exists

The original `epics.md` decomposes Phase 1 into four horizontal layered epics (Epic 3 = ML ingestion, Epic 4 = ML claims, Epic 5 = API, Epic 6 = frontend). That structure assumes a layer-specialist team and a designer handoff.

This team is two full-stack developers and a hard requirement for **end-to-end verification by the author of every change**. Horizontal layers prevent that — a developer finishing Epic 3 has no user-visible output to verify through the running app.

This document replaces Epics 3–6 with seven vertical slices. Each slice ships a thing a user can exercise end-to-end through `docker compose up`. Epic 1 (foundation) and Epic 2 (design tokens + shared specs) in `epics.md` are unchanged and remain authoritative for that work.

## Vertical slice principle

Each slice satisfies all four properties:

1. **End-to-end:** touches every layer needed to be user-visible (ML or DB → API → frontend).
2. **Author-verifiable:** the developer who wrote it can run `docker compose up` and exercise the change through the browser, not just through cURL or a test harness.
3. **Single owner per slice:** one developer owns the slice. The other reviews (code + workflow) per the protocol in `dev-plan.md`.
4. **Replaces a stub:** every slice after Slice 0 replaces a stub from a previous slice with the real implementation. The app is always running; the data behind it gets real over time.

## Slice list

| Slice | Name | Owner | Depends on | Replaces stubs from |
|---|---|---|---|---|
| **S0** | Walking skeleton (canned data, real wiring) | Both (split inside) | Epic 1 done | — |
| **S1A** | 8-K transcript ingest E2E | Dev 1 | S0 | S0 ML stub (transcripts) |
| **S1B** | 10-Q/10-K financials ingest E2E | Dev 2 | S0 | S0 ML stub (actuals) |
| **S2** | Temporal alignment E2E | Dev 1 | S1A + S1B | S0 alignment stub |
| **S3** | Claim extraction E2E | Dev 2 | S1A | S0 canned claims |
| **S4** | Verification + verdict + reasoning trace E2E | Dev 1 | S2 + S3 | S0 canned verdicts + traces |
| **S5** | CEO score E2E | Dev 2 | S4 | S0 canned score |
| **S6** | yfinance + accessibility + shareable URLs + cache hardening | Both (split inside) | S5 | — |

**Critical path:** S0 → S1A → S2 → S4 → S5 → S6. Dev 1 owns the longest chain.
**Parallel paths:** S1B runs alongside S1A. S3 runs alongside S2.

## Original story coverage

Every acceptance criterion from the superseded epics is preserved — they're redistributed across slices, not deleted. Mapping:

| Original story | Slice | Notes |
|---|---|---|
| 3.1 EDGAR client + rate limit | S1A | Dev 1 owns the file. S1B reuses it as a consumer. |
| 3.2 8-K transcript ingest | S1A | |
| 3.3 10-Q/10-K actuals ingest | S1B | |
| 3.4 Temporal aligner | S2 | |
| 3.5 yfinance supplement | S6 | Polish, not blocking. |
| 3.6 PostgreSQL caching | S1A + S1B + S6 | Each slice writes its cache; S6 hardens concurrency. |
| 4.1 Extraction agent | S3 | |
| 4.2 Safe-harbour + extraction confidence | S3 | |
| 4.3 Verification agent | S4 | |
| 4.4 Delta + verdict confidence | S4 | |
| 4.5 Reasoning trace logger | S4 | |
| 4.6 CEO score computation | S5 | |
| 5.1 BullMQ job queue | S0 | |
| 5.2 SSE progress stream | S0 | |
| 5.3 FastAPI → NestJS webhook | S0 | Real wiring, stub events. |
| 5.4 Company + search endpoints | S0 | |
| 5.5 Claims timeline + claim detail endpoints | S0 (stubs) → S3 (real claims) → S4 (real verdicts) | Endpoint exists in S0; data behind it gets real. |
| 5.6 CEO score endpoint | S0 (stub) → S5 (real) | |
| 6.1 Search + company routing | S0 | |
| 6.2 Analysis progress feed | S0 | Real EventSource wiring; canned events in S0. |
| 6.3 Promise timeline | S0 (canned) → S3 (real claims) | |
| 6.4 CEO score card | S0 (canned) → S5 (real score) | |
| 6.5 Claim detail panel | S0 (canned) → S4 (real verdicts) | |
| 6.6 Reasoning trace UI | S4 | |
| 6.7 Shareable URLs + accessibility audit | S6 | |

---

## S0 — Walking skeleton

**Owners:** Both, split internally
**Depends on:** Epic 1 complete (1.1–1.6)
**What ships:** A user can navigate to `/`, type a ticker, hit submit, see the analysis progress feed update in real time (canned events), land on a company page, see a canned timeline + canned score + canned claim detail panel + canned reasoning trace. Nothing is real except the wiring. The full request path is live: Angular → NestJS REST + SSE → BullMQ → FastAPI stub → webhook back → SSE → Angular.

**Internal split:**

| Sub-slice | Owner | Output |
|---|---|---|
| S0-ML | Dev 1 | FastAPI stub: `/analyze/{ticker}` accepts request, fires 5 canned webhook events back to NestJS over ~10s, then a `analysis-complete`. Returns canned claims + verdicts + reasoning trace JSON. LLM abstraction layer skeleton (no real provider calls). |
| S0-API | Dev 1 | NestJS: BullMQ job queue, SSE endpoint, webhook receiver, `MlSidecarService`, all REST endpoints stubbed (companies, claims, score) returning canned data from PostgreSQL. |
| S0-FE | Dev 2 | Angular: search page, company page shell, timeline component (renders from API), score card, claim detail panel, reasoning trace, EventSource client wired to SSE. All consume canned API data. |
| S0-DB | Dev 2 | Drizzle schema (already from Story 1.2 if not done; otherwise finalised here) + a seed script that inserts canned data for one ticker (`DEMO`) so the FE has something to render before any ingestion exists. |

**Sync points before merge:**
- **S1: Schema lock** — final `api/src/db/schema.ts` agreed.
- **S2: Enum lock** — verdicts, statuses, quarter format, confidence type — single doc.
- **S3: Webhook contract** — payload shape for `POST /internal/jobs/:jobId/progress`.
- **S4: Canned-data contract** — exact JSON shape for the canned analysis output, so subsequent slices know what to replace.

**Author E2E acceptance:**
- Both devs run `docker compose up` from a fresh clone, hit `http://localhost:4200`, search for `DEMO`, see the progress feed update, land on the company page, click into a claim, expand the reasoning trace.
- No real EDGAR calls, no real LLM calls, no manual DB seeding required (seed script runs in compose).

**FRs satisfied:** Architectural / wiring only. No FR is fully satisfied yet — they all become real in subsequent slices.

---

## S1A — 8-K transcript ingest end-to-end

**Owner:** Dev 1
**Depends on:** S0
**What ships:** A user searches `TSLA`, the analysis runs, real 8-K transcripts are fetched from EDGAR for the last 8 quarters, parsed, cached in PostgreSQL, and visible in the company page (e.g., "8 transcripts ingested" indicator + ability to view a transcript snippet from a claim card). Claims and verdicts are still canned.

**What changes per layer:**

| Layer | Change |
|---|---|
| ML | Implement `edgar_client.py` (rate limit, retries, logging). Implement 8-K transcript parser. Replace S0 transcript stub with real fetch. Persist to `transcripts` table via asyncpg. |
| DB | `transcripts` table populated with real data. |
| API | New endpoint `GET /api/v1/companies/:ticker/transcripts` (or expose count + sample in existing company endpoint). |
| FE | Company page header shows "N transcripts ingested" badge. Claim card shows the source filing URL link (real EDGAR URL). |

**Author E2E acceptance (Dev 1 verifies before requesting review):**
- Fresh `docker compose up`. Search `TSLA`. Within 3 minutes, company page shows real EDGAR transcript count.
- Click any claim → see real EDGAR filing URL (still pointing to a real 8-K, even if the claim itself is canned).
- Restart the stack. Search `TSLA` again. Cache hit: ingestion completes in < 30s. Log entry confirms `cache_hit: true`.

**FRs satisfied:** FR1, FR4 (alignment logging — partial, transcript side only), FR5 (caching — transcripts), FR38 (EDGAR source URL).

**Single-owner declarations:** Dev 1 owns `ml-sidecar/src/core/edgar_client.py` for the rest of Phase 1. S1B consumes it as a dependency.

---

## S1B — 10-Q/10-K financials ingest end-to-end

**Owner:** Dev 2
**Depends on:** S0
**Runs in parallel with:** S1A (shares EDGAR client; S1A defines it first if start is staggered)
**What ships:** Same as S1A but for 10-Q/10-K filings. A user sees "8 quarterly actuals ingested" and can view extracted metrics (revenue, EPS, etc.) for any quarter via a debug panel or claim card metadata. Verification still canned.

**What changes per layer:**

| Layer | Change |
|---|---|
| ML | 10-Q/10-K parser. Persist to `actuals` table via asyncpg. Reuses S1A's `edgar_client.py`. |
| DB | `actuals` table populated. |
| API | New endpoint `GET /api/v1/companies/:ticker/actuals` (or similar). |
| FE | Company page header shows "N actuals ingested" badge. Claim card shows the actual metric value next to the claimed value (still canned claims; real actuals). |

**Author E2E acceptance:**
- Fresh start. Search `TSLA`. See "8 actuals ingested" badge.
- Click any claim → see real metric value pulled from EDGAR (e.g., real Q3-2024 revenue).
- Cache hit on second analysis.

**Coordination with S1A:** If S1A ships first, S1B inherits a stable EDGAR client. If S1B starts before S1A finishes, Dev 2 stubs the client locally; Dev 1's S1A merge is the integration point.

**FRs satisfied:** FR2, FR5 (caching — actuals).

---

## S2 — Temporal alignment end-to-end

**Owner:** Dev 1
**Depends on:** S1A + S1B
**What ships:** A user clicks any claim and sees, in the claim detail panel, the alignment metadata: which actuals filing this claim was matched to, the alignment confidence (HIGH / LOW), and the rationale. PENDING claims are surfaced where no actuals filing exists yet.

**What changes per layer:**

| Layer | Change |
|---|---|
| ML | Implement `temporal_aligner.py`. Write alignment decisions to `claim_alignments` table (or equivalent). Surface PENDING status when no actuals exist. |
| DB | Alignment records persisted. |
| API | Claim detail endpoint returns `alignment: { actualsQuarter, filingType, confidence, rationale, status }`. |
| FE | Claim detail panel shows alignment metadata block. Timeline distinguishes PENDING claims visually (uses the verdict badge spec for PENDING). |

**Author E2E acceptance:**
- Search a ticker with sparse history (test with `DEMO` seeded as a recently-listed company). See PENDING claims rendered on the timeline.
- Click a resolved claim → see "Aligned to Q3-2024 10-Q (HIGH confidence)" in the detail panel.
- Click a PENDING claim → see "No actuals filing yet" with the expected quarter.

**FRs satisfied:** FR3, FR4 (full alignment logging).

---

## S3 — Claim extraction end-to-end

**Owner:** Dev 2
**Depends on:** S1A
**Runs in parallel with:** S2
**What ships:** A user searches a ticker, the analysis runs, and real LLM-extracted claims appear on the timeline (replacing canned ones). Each claim shows the real raw quote, real speaker attribution, real extraction confidence. Verdicts are still canned (S4 makes those real).

**What changes per layer:**

| Layer | Change |
|---|---|
| ML | Implement `extraction_service.py` calling `BaseLLMProvider`. Implement safe-harbour boilerplate filter. Assign extraction confidence per claim. Persist to `claims` table. |
| DB | Real claims rows. |
| API | `GET /api/v1/companies/:ticker/claims` returns real claims (replacing the S0 canned response). |
| FE | Timeline renders real claims. Low-extraction-confidence claims visually flagged. |

**Author E2E acceptance:**
- Search `TSLA`. Wait for analysis (will hit real LLM API — costs money; budget per `NFR18`).
- Timeline shows real claims pulled from real transcripts. Verify against an actual TSLA earnings call by spot-checking 2–3 quotes.
- A high-confidence claim ("We expect revenue of $X in Q3") shows a confidence indicator distinct from a hedged one ("We think revenue could be around $X").

**FRs satisfied:** FR8, FR9, FR10, FR11.

**Single-owner declarations:** Dev 2 owns `ml-sidecar/src/services/extraction_service.py` and the LLM abstraction layer's extraction-related prompts.

---

## S4 — Verification + verdict + reasoning trace end-to-end

**Owner:** Dev 1
**Depends on:** S2 + S3
**What ships:** Real verdicts (DELIVERED / MISSED / INSUFFICIENT_DATA) replace canned ones. Each claim has a real reasoning trace expandable in the UI with inline EDGAR citations. The delta is computed and displayed. Confidence score per verdict is visible. This is the largest slice — it's also where BullByte becomes BullByte.

**What changes per layer:**

| Layer | Change |
|---|---|
| ML | Implement `verification_service.py` (verification agent). Compute delta. Assign verdict confidence. Implement reasoning trace logger writing to `reasoning_traces` table per agent step. |
| DB | Real `verdicts` rows (immutable, append-only enforced). Real `reasoning_traces` rows. |
| API | `GET /api/v1/claims/:claimId` returns real verdict + delta + reasoning trace + EDGAR citations. Webhook events from FastAPI report each verification step in real time (replacing canned S0 events). |
| FE | Claim detail panel shows real verdict badge + delta + confidence indicator. Reasoning trace component renders the real ordered tool-call list with inline EDGAR links. Low-confidence verdicts visually flagged. |

**Author E2E acceptance:**
- Search `TSLA`. Watch the progress feed update in real time as each claim is verified ("Verifying claim 3 of 14...").
- Pick a known TSLA earnings claim with a known outcome (e.g., a missed revenue guidance). Confirm the verdict matches reality.
- Expand the reasoning trace. Verify each step has a real EDGAR citation that opens in a new tab and points to the right filing.
- Force an INSUFFICIENT_DATA case (search a ticker with no actuals yet) and confirm the trace shows the failure step honestly.

**FRs satisfied:** FR13, FR14, FR15, FR16, FR17, FR18, FR34 (real progress events), FR36, FR37, FR38, FR39, FR40, FR45 (immutable writes).

---

## S5 — CEO score end-to-end

**Owner:** Dev 2
**Depends on:** S4
**What ships:** The score card on the company page shows a real CEO Delivery Score with sample-size context, computed from real verdicts. "No resolved claims yet" displayed when applicable.

**What changes per layer:**

| Layer | Change |
|---|---|
| ML | Implement `scoring_service.py`. |
| DB | No new tables — score is derived from existing `verdicts` (per `NFR7` append-only). |
| API | `GET /api/v1/companies/:ticker/score` returns real score with `deliveredCount`, `missedCount`, `totalResolved`, `pendingCount`, `insufficientDataCount`. Returns `score: null + context: "No resolved claims yet"` when no resolved verdicts. |
| FE | Score card replaces canned score with real one. Sample-size context visible. Pending count displayed. Trend indicator if implementable from append-only verdicts. |

**Author E2E acceptance:**
- Search `TSLA`. Score card shows a real fraction (e.g., "6 of 10 resolved numerical promises delivered. 3 pending.").
- Search a ticker with no resolved verdicts (force via a recently-listed test ticker). Score card shows "No resolved claims yet" — not 0.

**FRs satisfied:** FR22, FR23, FR24.

---

## S6 — yfinance + accessibility + shareable URLs + cache hardening

**Owners:** Both, split internally
**Depends on:** S5
**What ships:** Phase 1 polish. Demo-readiness for the 5 target tickers (TSLA, AAPL, SPOT, META, NVDA). Accessibility baseline met.

**Internal split:**

| Sub-slice | Owner | Output |
|---|---|---|
| S6-A | Dev 1 | yfinance supplement (FR6) for AMBIGUOUS metrics. Cache concurrency hardening (NFR11) — confirm no duplicate writes under concurrent same-ticker requests. |
| S6-B | Dev 2 | Shareable claim-detail URLs (FR41) — claim state in URL params, deep-link works without auth. Accessibility audit (NFR20–23, UX-DR7): semantic HTML pass, keyboard navigation pass, colour-contrast pass, 320px viewport pass. |
| S6-C | Both | Demo dry-run: process all 5 demo tickers end-to-end fresh. Verify each Phase 1 acceptance criterion from `prd.md` is met. Capture as a checklist in this file's "Phase 1 sign-off" section once complete. |

**FRs satisfied:** FR6, FR41, NFR11, NFR20, NFR21, NFR22, NFR23.

---

## Updated dependency graph

```
Epic 1 (foundation, layered — see epics.md)
   └─ S0 walking skeleton (both, parallel internal split)
        ├─ S1A 8-K transcripts (Dev 1)        ║   S1B 10-Q/10-K actuals (Dev 2)
        │      └─ S2 temporal alignment (Dev 1)   ║   S3 claim extraction (Dev 2)
        │              └─ S4 verification + reasoning trace (Dev 1)
        │                      └─ S5 CEO score (Dev 2)
        │                              └─ S6 polish (both, split)
```

**Parallel windows:**
- S1A ‖ S1B (after S0)
- S2 ‖ S3 (after S1A; S2 also needs S1B)
- During S4 (Dev 1 deep work): Dev 2 can prep S5 (write tests against canned verdict shapes from S0)
- During S5 (Dev 2): Dev 1 can start S6-A

## Single-owner file declarations

To keep the parallel paths clean, these files have a single owner for all of Phase 1. The other dev requests changes via PR.

| File / module | Owner | Established in |
|---|---|---|
| `api/src/db/schema.ts` | Dev 2 | S0 (S1 sync point) |
| `ml-sidecar/src/core/edgar_client.py` | Dev 1 | S1A |
| `ml-sidecar/src/core/llm/base.py` + provider impls | Dev 1 | S0 |
| `ml-sidecar/src/services/extraction_service.py` | Dev 2 | S3 |
| `ml-sidecar/src/services/verification_service.py` | Dev 1 | S4 |
| `api/src/common/ml-sidecar.service.ts` | Dev 1 | S0 |
| Shared SSE event names + payload types | Dev 2 | S0 (S3 sync point) |
| Shared TypeScript types for API DTOs | Dev 2 | S0 |

## Review protocol (unchanged from `dev-plan.md`)

Every slice PR requires both:
1. **Code review** by the non-author dev.
2. **Workflow review** — non-author dev pulls the branch, runs `docker compose up`, exercises the slice end-to-end through the browser, and re-runs the most recent cumulative happy path to confirm no upstream/downstream regression. PR description records what was run and observed.

A slice is not `done` until both reviews are signed off.

## Phase 1 sign-off (filled at end of S6)

- [ ] All 5 demo tickers (TSLA, AAPL, SPOT, META, NVDA) process end-to-end on a fresh stack.
- [ ] ≥50 verdicts manually spot-checked across the 5 tickers (per `prd.md:66`).
- [ ] Numerical verdict accuracy ≥78% on the spot-checked set.
- [ ] J1 (Priya happy path) walked through end-to-end without intervention.
- [ ] J3 (Rohan source-link deep dive) walked through end-to-end without intervention.
- [ ] J2 PENDING handling confirmed for sparse-history tickers.
- [ ] Disclaimer footer present on every page.
- [ ] No `console.log`, no hardcoded secrets, no PII collection at any layer.
- [ ] Accessibility audit (S6-B) checklist signed off.
- [ ] Demo run (S6-C) recorded.
