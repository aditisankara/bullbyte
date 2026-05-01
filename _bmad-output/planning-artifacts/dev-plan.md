---
created: 2026-05-01
last_updated: 2026-05-01
team_size: 2
phase_scope: phase-1-primary
input_documents:
  - _bmad-output/planning-artifacts/prd.md
  - _bmad-output/planning-artifacts/epics.md
  - _bmad-output/planning-artifacts/architecture.md
  - _bmad-output/implementation-artifacts/sprint-status.yaml
---

# BullByte — Dev Plan (Phase 1)

## What this document is

A dependency-based execution plan for Phase 1, derived from `epics.md` and `architecture.md`. It tells you:

- The optimal order to develop in.
- What can run in parallel at each step.
- Which stories block which.
- Where the team must agree on a contract before either side codes.
- What review must happen before any story is `done`.

It does **not** assign stories to specific developers. Pick stories by availability — at any moment, take the highest-priority unblocked story that doesn't conflict with what the other dev is actively touching.

## Critical path

The longest dependency chain in Phase 1 is:

```
1.1 → 1.2/1.3 → 3.1 → (3.2 ‖ 3.3) → 3.4 → 4.1 → 4.3 → 4.6 → 5.6 → 6.4 → 6.7
```

Eleven stories, sequential. Anything you can do to keep the *next* story on this path unblocked is the highest-leverage scheduling decision available.

The shortest non-trivial path (search-only happy path) is:

```
1.1 → 1.4/1.5 → 5.1 → 5.4 → 6.1 → 6.7
```

Six stories. This is what's demoable earliest if you accept canned data behind it.

## Phase 1 execution flow

### Step 1 — kickoff (1 story, blocks everything)

| Story | Notes |
|---|---|
| **1.1** Docker Compose stack | Single-developer story. Until this lands, no other story has somewhere to run. **Currently in `review`.** |

### Step 2 — foundation fan-out (5 stories, all parallel after 1.1)

These five stories have no dependencies on each other. Up to two can run truly in parallel given the team size; the rest queue.

| Story | Blocked by | Notes |
|---|---|---|
| **1.2** PostgreSQL schema + Drizzle | 1.1 | Drafts the canonical schema. Triggers **sync point SP1** (schema lock). |
| **1.3** FastAPI ML sidecar scaffold | 1.1 | Includes LLM abstraction skeleton. |
| **1.4** NestJS API scaffold | 1.1 | Includes `MlSidecarService`, error filter, throttler, logging. |
| **1.5** Angular SPA scaffold | 1.1 | Routes, error interceptor, footer. |
| **1.6** GitHub Actions CI | 1.1 | No downstream dependencies. Grab whenever there's a gap. |

**Topological priority within Step 2:** 1.2 + 1.3 are upstream of more later stories (Epic 3, 4, 5.3) than 1.4 + 1.5 are. If forced to choose, do 1.2 + 1.3 first.

### Step 3 — three independent tracks open up

Once Step 2 is mostly done, three independent tracks can run in parallel. None of them blocks the others until very late in Phase 1.

#### Track ML (Epic 3 → Epic 4)

```
3.1 (needs 1.3)
 ├── 3.2 ──┐
 └── 3.3 ──┼── 3.4 (needs 3.2 + 3.3)
           │
           ├── 3.5 (needs 3.3; parallel with 3.4)
           │
           └── 3.6 (needs 3.2 + 3.3 + 1.2)

then Epic 4:
4.1 (needs 1.3 + 3.2)
 └── 4.2 (needs 4.1)
 └── 4.3 (needs 4.1 + 3.3 + 3.4) ── parallel with 4.2
      ├── 4.4 (needs 4.3)
      ├── 4.5 (needs 4.3) ── parallel with 4.4
      └── 4.6 (needs 4.3) ── parallel with 4.4 + 4.5
```

**Inside-track parallelism:** 3.2 ‖ 3.3, then 3.4 ‖ 3.5, then 3.6 (after 3.2 + 3.3). Then 4.2 ‖ 4.3, then 4.4 ‖ 4.5 ‖ 4.6.

**Risk flag:** Story 3.4 (temporal aligner) is the highest-risk story in Phase 1 per `prd.md:313`. Do not rush it; uncertain alignments must produce `INSUFFICIENT_DATA`, never silent wrong mappings.

#### Track API (Epic 5)

```
5.1 (needs 1.4) ── 5.2 (needs 5.1) ── 5.3 (needs 5.2 + 1.3)
5.4 (needs 1.4) ── parallel with 5.1

then (after Epic 4 starts producing verdicts):
5.5 (needs 5.4 + Epic 4 — specifically 4.4 + 4.5)
5.6 (needs 4.6 + 5.4)
```

**Inside-track parallelism:** 5.1 ‖ 5.4 immediately. Then 5.2 → 5.3 sequentially while Epic 4 cooks. 5.5 and 5.6 wait for Epic 4.

**Sync point trigger:** 5.3 needs **SP3** (webhook contract) signed off before either side implements.

#### Track Design (Epic 2)

```
2.1 (no story dependencies — only needs the team to start)
 └── 2.2
      ├── 2.3 ── parallel
      ├── 2.4 ── parallel
      ├── 2.5 ── parallel
      └── 2.6 (caps Epic 2; blocks Epic 6 layout)
```

**Inside-track parallelism:** 2.3 ‖ 2.4 ‖ 2.5 ‖ 2.6 after 2.2.

Epic 2 is fully independent — it doesn't depend on any code epic and doesn't block any code work until Epic 6. Run it whenever there's capacity. **Must be done before Epic 6 starts.**

### Step 4 — frontend (Epic 6, story-level fan-in)

Epic 6 stories unblock individually as their corresponding API endpoints land. They do not require all of Epic 5 to be done first.

| Story | Blocked by | Notes |
|---|---|---|
| **6.1** Search + company routing | 1.5 + 5.4 + (Epic 2 spec for search page) | Earliest Epic 6 story. |
| **6.2** Analysis progress feed (SSE) | 1.5 + 5.2 + (Epic 2 spec for progress feed) | |
| **6.3** Promise timeline | 1.5 + 5.5 + (Epic 2 spec for timeline) | Hard wait on 5.5 (which waits on Epic 4). |
| **6.4** CEO score card | 1.5 + 5.6 + (Epic 2 spec for score card) | Hard wait on 5.6. |
| **6.5** Claim detail panel | 1.5 + 5.5 + (Epic 2 spec for detail panel) | Hard wait on 5.5. |
| **6.6** Reasoning trace | 6.5 | |
| **6.7** Shareable URLs + accessibility audit | All of Epic 6 | Caps Phase 1. |

**Inside-track parallelism:** 6.1 ‖ 6.2 can start as soon as 5.4 and 5.2 are done — long before Epic 4 finishes. 6.3 ‖ 6.4 ‖ 6.5 wait for Epic 4 + late Epic 5.

## Full dependency table

For quick lookup. Format: story → blocked by → unblocks.

| Story | Blocked by | Unblocks |
|---|---|---|
| 1.1 | — | 1.2, 1.3, 1.4, 1.5, 1.6 (transitively: everything) |
| 1.2 | 1.1 | 3.6, all asyncpg/Drizzle reads downstream |
| 1.3 | 1.1 | 3.1, 4.1, 5.3 |
| 1.4 | 1.1 | 5.1, 5.4 |
| 1.5 | 1.1 | 6.1–6.7 |
| 1.6 | 1.1 | (none — but should land before too many PRs accumulate) |
| 2.1 | — | 2.2 |
| 2.2 | 2.1 | 2.3, 2.4, 2.5, 2.6 |
| 2.3 | 2.2 | (consumed by 6.1, 6.2) |
| 2.4 | 2.2 | (consumed by 6.3) |
| 2.5 | 2.2 | (consumed by 6.5, 6.6) |
| 2.6 | 2.2 | (consumed by 6.4, 6.7) |
| 3.1 | 1.3 | 3.2, 3.3 |
| 3.2 | 3.1 | 3.4, 3.6, 4.1 |
| 3.3 | 3.1 | 3.4, 3.5, 3.6, 4.3 |
| 3.4 | 3.2 + 3.3 | 4.3 (semantically — alignment must exist before verification is meaningful) |
| 3.5 | 3.3 | (no hard downstream — feeds 4.x as supplement) |
| 3.6 | 3.2 + 3.3 + 1.2 | (caching — non-blocking but recommended before high-volume runs) |
| 4.1 | 1.3 + 3.2 | 4.2, 4.3 |
| 4.2 | 4.1 | (extraction quality improvement; non-blocking for downstream) |
| 4.3 | 4.1 + 3.3 + 3.4 | 4.4, 4.5, 4.6, 5.5 |
| 4.4 | 4.3 | (verdict completeness; consumed by 5.5) |
| 4.5 | 4.3 | (reasoning trace; consumed by 5.5 + 6.6) |
| 4.6 | 4.3 | 5.6 |
| 5.1 | 1.4 | 5.2 |
| 5.2 | 5.1 | 5.3, 6.2 |
| 5.3 | 5.2 + 1.3 | (real-time progress relay) |
| 5.4 | 1.4 | 5.5, 5.6, 6.1 |
| 5.5 | 5.4 + 4.3 (+ 4.4, 4.5 for completeness) | 6.3, 6.5 |
| 5.6 | 5.4 + 4.6 | 6.4 |
| 6.1 | 1.5 + 5.4 + 2.3 | 6.7 |
| 6.2 | 1.5 + 5.2 + 2.3 | 6.7 |
| 6.3 | 1.5 + 5.5 + 2.4 | 6.7 |
| 6.4 | 1.5 + 5.6 + 2.6 | 6.7 |
| 6.5 | 1.5 + 5.5 + 2.5 | 6.6 |
| 6.6 | 6.5 + 4.5 + 2.5 | 6.7 |
| 6.7 | 6.1 + 6.2 + 6.3 + 6.4 + 6.5 + 6.6 | Phase 1 sign-off |

## Cross-team coordination points (sync deliverables)

These are contracts that must be agreed in writing before either side codes against them. Each is a deliverable, not just a meeting. Agree on the artifact, commit it (in code or in a planning doc), and don't change it without joint sign-off.

| # | Sync point | When | Artifact |
|---|---|---|---|
| **SP1** | **Schema lock** | Before 1.2 merges | Final `api/src/db/schema.ts`. No changes to verdicts/claims/reasoning_traces tables in Phase 1 without joint sign-off. |
| **SP2** | **Canonical enum lock** | Before 1.2 + 1.3 merge | Single source-of-truth doc listing verdict types, job statuses, quarter format (`"Q3-2024"`), confidence range (0–1 numeric). Cross-referenced by FastAPI Pydantic models, Drizzle schema, NestJS DTOs, Angular types. See `epics.md:135-139`. |
| **SP3** | **Webhook contract** | Before 5.3 starts | JSON payload shape for `POST /internal/jobs/:jobId/progress` — fields, kebab-case event names, timestamp format. Lives as a shared TypeScript + Pydantic type definition. |
| **SP4** | **Cache contract** | During 3.6 | What counts as a cache hit (ticker + quarter granularity), what triggers re-ingestion. Documented in story 3.6 PR. |
| **SP5** | **End-to-end demo run** | After 6.7 | Full stack started fresh, all 5 demo tickers (TSLA, AAPL, SPOT, META, NVDA) processed end-to-end, journeys J1 + J3 walked through. Captured as a video or step-by-step doc. |

## Review protocol — code AND workflow

Every story PR requires both reviews, performed by the developer who didn't author the story. A story is not `done` until both pass.

### 1. Code review (standard)

- Diff readable, naming clear, no dead code, no `console.log`, no hardcoded secrets, follows the layer boundaries (`epics.md:166-180`).
- Story-specific acceptance criteria from `epics.md` are met.

### 2. Workflow review

- Reviewer pulls the branch, runs `docker compose up`, and exercises the change end-to-end through the full stack — not just the changed service.
- Reviewer also re-runs the most recent successful happy path (whatever was demoable before this story landed) to confirm no upstream/downstream regression. Even if the story only touches `[ML]`, the reviewer hits it via the API path if the API exists at that point.
- For early-Phase-1 stories where the full stack isn't wired yet, workflow review is "exercise the service via its own contract" (cURL the FastAPI endpoint, run the migration, view the rendered Angular shell, etc.).
- Reviewer documents what they ran in the PR description: command, expected output, observed output. No "LGTM" without evidence.

**Why this matters here:** The layer split means each developer easily ships code that works in isolation but breaks the seam (enum mismatch, schema drift, payload shape change). The workflow check is the only thing that catches that before integration day.

## Recommended pickup order

A flat priority list, ignoring developer identity. At any moment, the highest-priority unblocked story is the right one to pick up.

1. **1.1** (already in review — finish the review-cycle).
2. After 1.1 merges: **1.2 + 1.3** (these two unblock the most). Then **1.4 + 1.5** (unblock the parallel API + FE tracks). **1.6** anytime.
3. As soon as 1.3 lands: start **3.1** and **2.1** in parallel — Epic 3 has the longest internal chain (critical path).
4. As soon as 1.4 lands: start **5.1 + 5.4** in parallel — both unblock significant downstream work.
5. Then proceed within each track per its dependency graph (above), keeping the critical path moving (Epic 3 → Epic 4 → 5.5/5.6 → Epic 6).
6. Epic 2 stories (2.2 → 2.3/2.4/2.5/2.6) fill any gaps and must complete before their corresponding Epic 6 story starts.
7. Epic 6 stories begin individually as their API + design dependencies land — don't wait for all of Epic 5 to finish before starting Epic 6.
8. **6.7** caps Phase 1.

## Risks specific to Phase 1

| Risk | Mitigation |
|---|---|
| 3.4 (temporal aligner) is the highest-risk story per PRD; if it slips, Epic 4 cannot proceed and downstream API + FE work backs up | Build 3.4 as fully-logged from day one; uncertain alignments produce `INSUFFICIENT_DATA`, never silent wrong mapping. Allocate buffer time. |
| Schema or enum drift between FastAPI and NestJS layers | Sync points SP1 + SP2 are gating — no merge without joint sign-off. |
| Workflow review skipped under deadline pressure | Story is not `done` without both reviews; sprint-status stays `review` until both signed off. |
| Critical path is mostly ML-side; the API/FE devs may finish their early tracks and idle while waiting for Epic 4 | Epic 2 (design), 5.1–5.4, 6.1–6.2 are all available in parallel and fill that wait. |
| EDGAR document parsing inconsistent across companies and years | Per-PRD: per-company format detection in 3.2 + 3.3; fallback to `INSUFFICIENT_DATA` on parse failure. Phase 1 prioritises the 5 demo tickers before generalising. |
| LLM API cost overrun during 4.1 + 4.3 development iterations | NFR18 cost logging is non-negotiable; configure cost thresholds in `.env`; develop against cached transcripts where possible. |

---

## Appendix A — Phase 2 (deferred)

**Trigger:** Phase 1 demo accepted; Phase 1 numerical verdict accuracy ≥78% on 50+ spot-checked claims (per `prd.md:66`).

Stories from `epics.md` FR-coverage map tagged `Deferred P2`:

- **FR7** — Non-US ingestion adapters (BSE/NSE, SGX) — separate format adapters extending Epic 3.
- **FR12** — Qualitative + directional claim extraction — extends Epic 4.
- **FR19, FR20, FR21** — `reconcile_definitions()`, `search_subsequent_calls()`, REVISED verdict — extends verification agent in Epic 4.
- **FR25** — Ground-truth dataset records per resolved claim — additive to verdicts table.
- **FR35** — Side-by-side Revised claim display in UI — depends on FR21.

**Suggested Phase 2 ordering**

1. FR19 + FR20 + FR21 (revised-verdict pipeline) — unblocks FR35 and journeys J2 + J4.
2. FR12 (qualitative claims) — unblocks J4 fully.
3. FR35 (UI for revisions).
4. FR25 (ground-truth records — passive collection, low risk).
5. FR7 (non-US adapters) — last; legal/sourcing decision required first per `prd.md:139`.

**Plus:** SEO work (ticker pages indexable, meta tags) — frontend.

## Appendix B — Phase 3 (deferred)

**Trigger:** Phase 2 complete; ≥150 ground-truth records collected.

- **FR26** — Multi-LLM benchmark runner — depends on FR25.
- **FR27** — Per-model accuracy metrics.
- **FR42** — LLM leaderboard UI.
- **FR43** — Dataset export.

**Suggested ordering:** FR26 → FR27 → FR42 ‖ FR43.

Phase 3 is the natural flex point if Phase 1 or 2 runs long, per `prd.md:317`. Benchmark collection (FR25) starts in Phase 2 so the research contribution survives a delayed Phase 3.
