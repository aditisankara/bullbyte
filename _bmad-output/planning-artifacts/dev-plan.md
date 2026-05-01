---
created: 2026-05-01
last_updated: 2026-05-01
team_size: 2
phase_scope: phase-1-primary
input_documents:
  - _bmad-output/planning-artifacts/prd.md
  - _bmad-output/planning-artifacts/epics.md
  - _bmad-output/planning-artifacts/slices.md
  - _bmad-output/planning-artifacts/architecture.md
  - _bmad-output/implementation-artifacts/sprint-status.yaml
---

# BullByte — Phase 1 Dev Plan (2-person team)

> **Phase 1 execution plan was restructured on 2026-05-01.** Epics 3–6 are superseded by vertical slices defined in `slices.md`. Both devs are full-stack — ownership is per-slice, not per-layer. Epic 1 (foundation) and Epic 2 (slimmed design) remain as defined in `epics.md`. The dependency table for Phase 1 below has been updated to match.

## Team & ownership

- **Dev 1** and **Dev 2** are both full-stack. Ownership is assigned per slice, not per layer. See `slices.md` for the full slice plan.
- Story `1.1` is currently in `review` and was picked up by **Dev 1**.
- No stubbing across slice boundaries: each slice replaces canned data from the walking skeleton (S0) with the real implementation.

## Critical path

```
Epic 1 (foundation, layered)
   └─ S0 walking skeleton (both, parallel internal split)
        ├─ S1A 8-K transcripts (Dev 1)        ║   S1B 10-Q/10-K actuals (Dev 2)
        │      └─ S2 temporal alignment (Dev 1)   ║   S3 claim extraction (Dev 2)
        │              └─ S4 verification + reasoning (Dev 1)
        │                      └─ S5 CEO score (Dev 2)
        │                              └─ S6 polish (both, split)
```

The longest path is **Epic 1 → S0 → S1A → S2 → S4 → S5 → S6**. Dev 1 owns the longer chain (S1A, S2, S4, S6-A); Dev 2's chain (S1B, S3, S5, S6-B) is shorter but more spread, so the load is balanced. Detailed per-slice ownership and acceptance is in `slices.md`.

## Phase 1 — story-level dependency table

Status legend: `review` `backlog` `in-progress` `done`. Owner column lists primary owner; reviewer is always the other dev.

### Epic 1 — Foundation (layered, per `epics.md`)

| Story | Owner | Status | Blocked by | Unblocks | Notes |
|---|---|---|---|---|---|
| 1.1 Docker Compose stack | Dev 1 | review | — | everything | Already in review. Dev 2 must run end-to-end review (see protocol). |
| 1.2 PostgreSQL schema + Drizzle | Dev 2 | backlog | 1.1 | S0, all later slices | **Schema lock checkpoint.** Dev 2 owns the schema file for all of Phase 1 (per `slices.md` single-owner table). |
| 1.3 FastAPI ML sidecar scaffold | Dev 1 | backlog | 1.1 | S0 | Includes LLM abstraction skeleton. Dev 1 owns the LLM abstraction for all of Phase 1. |
| 1.4 NestJS API scaffold | Dev 1 | backlog | 1.1 | S0 | Includes `MlSidecarService`, error filter, throttler, logging. Dev 1 owns `MlSidecarService` for all of Phase 1. |
| 1.5 Angular SPA scaffold | Dev 2 | backlog | 1.1 | S0 | Routes, error interceptor, footer. |
| 1.6 GitHub Actions CI | Dev 2 | backlog | 1.1 | — | Pick up between 1.5 and S0. |

**Note on the Epic 1 split:** Dev 1 still does a heavier slice (1.3 + 1.4) so that the ML sidecar scaffold + the NestJS sidecar consumer are written by the same person — they share the canned-data contract from S0. Dev 2 takes 1.2 + 1.5 + 1.6, owning the schema and the FE shell.

### Epic 2 — Design slice (slimmed)

Dev 2 owns this. Slimmed because Dev 2 is also the consumer of the design — no formal handoff needed. Run **2.1 + 2.2 only** before S0 ships its FE shell; defer 2.3–2.6 to be authored inline alongside the matching slice.

| Story | Owner | Status | When | Notes |
|---|---|---|---|---|
| 2.1 Design tokens | Dev 2 | backlog | Before S0-FE | Colours, type scale, spacing scale, verdict colours. |
| 2.2 Shared component specs | Dev 2 | backlog | Before S0-FE | Verdict badge, confidence indicator, footer, error states. |
| 2.3–2.6 Per-feature specs | Dev 2 | deferred | Inline with the matching slice | Build-as-you-go. Capture the spec in code comments / Storybook story, not a separate doc. |

### Vertical slices (replaces Epics 3, 4, 5, 6 — full detail in `slices.md`)

| Slice | Owner | Status | Blocked by | Notes |
|---|---|---|---|---|
| **S0** Walking skeleton | Both (split inside) | backlog | Epic 1 + 2.1 + 2.2 | Canned-data E2E. Both devs own halves; sync at SP1 + SP2 + SP3 + SP4 below. |
| **S1A** 8-K transcripts E2E | Dev 1 | backlog | S0 | Owns `edgar_client.py` going forward. Replaces S0 transcript stub. |
| **S1B** 10-Q/10-K actuals E2E | Dev 2 | backlog | S0 | Reuses S1A's EDGAR client. Parallel with S1A. Replaces S0 actuals stub. |
| **S2** Temporal alignment E2E | Dev 1 | backlog | S1A + S1B | **Highest-risk slice** in Phase 1 (per `prd.md:313`). Don't rush. |
| **S3** Claim extraction E2E | Dev 2 | backlog | S1A | Owns `extraction_service.py`. Parallel with S2. |
| **S4** Verification + verdict + reasoning trace E2E | Dev 1 | backlog | S2 + S3 | Largest slice. Owns `verification_service.py`. |
| **S5** CEO score E2E | Dev 2 | backlog | S4 | Replaces S0 canned score with real one. |
| **S6** yfinance + accessibility + shareable URLs + cache hardening | Both (split inside) | backlog | S5 | Phase 1 polish + demo dry-run on 5 demo tickers. |

## Cross-team sync points

These are the seams where the two tracks must align in writing before either side codes. Each is a deliverable, not just a meeting.

| # | Checkpoint | When | Output | Owner |
|---|---|---|---|---|
| SP1 | **Schema lock** | Before 1.2 merges | Final `api/src/db/schema.ts` reviewed and signed off by Dev 1 (who reads it from the ML side via asyncpg). No further changes to verdicts/claims/reasoning_traces tables in Phase 1 without joint sign-off. | Dev 2 drafts, Dev 1 approves |
| SP2 | **Canonical enum lock** | Before S0 merges | Single source-of-truth doc listing verdict types, job statuses, quarter format (`"Q3-2024"`), confidence range (0–1 numeric). Cross-referenced by FastAPI Pydantic models, Drizzle schema, NestJS DTOs, Angular types. See `epics.md:135-139`. | Dev 1 drafts (defines Pydantic + Drizzle), Dev 2 approves (consumes from API + FE) |
| SP3 | **Webhook contract** | Before S0 merges (FastAPI fires real webhook events even with canned payloads) | JSON payload shape for `POST /internal/jobs/:jobId/progress` — fields, kebab-case event names, timestamp format. Lives in a shared TypeScript + Pydantic type definition. | Dev 1 drafts (FastAPI is the producer in S0), Dev 2 approves (NestJS + FE consume) |
| SP4 | **Canned-data contract** | Before S0 merges | Exact JSON shape for the S0 canned analysis output (claims, verdicts, reasoning trace). Subsequent slices replace these stubs in place. | Dev 1 drafts (S0 stub author), Dev 2 approves (FE renders it) |
| SP5 | **Cache contract** | During S1A + S1B | Agreement on cache key (ticker + quarter granularity) and what triggers re-ingestion. Documented in S1A and S1B PRs. | Dev 1 drafts (S1A first), Dev 2 mirrors in S1B |
| SP6 | **End-to-end demo run** | S6-C | Full stack started fresh, all 5 demo tickers (TSLA, AAPL, SPOT, META, NVDA) processed end-to-end, journeys J1 + J3 walked through. Captured as a video or step-by-step doc. | Both |

## Review protocol — code AND workflow

Every story PR requires both, performed by the non-author dev. Story is not `done` until both pass.

**1. Code review** (standard)
- Diff readable, naming clear, no dead code, no `console.log`, no hardcoded secrets, follows the layer boundaries (`epics.md:166-180`).
- Slice-specific acceptance criteria from `slices.md` (or for Epic 1/2 stories, from `epics.md`) are met.

**2. Workflow review** (the bit you asked for)
- Reviewer pulls the branch, runs `docker compose up`, and exercises the slice end-to-end through the browser — not just the changed service.
- Reviewer also re-runs the most recent cumulative happy path (whichever slices are currently merged) to confirm no upstream/downstream regression.
- Because every slice ships an end-to-end change after S0, every slice has a real browser-level acceptance check. Pre-S0 stories (Epic 1) use a per-service contract check (cURL the FastAPI endpoint, run the migration, etc.).
- Reviewer documents what they ran in the PR description: command, expected output, observed output. No "LGTM" without evidence.

**Why this matters here:** vertical slices keep both devs honest about end-to-end behaviour, but the seam files (schema, shared types, webhook contract) are still single-owner and easy to break silently. The workflow check is the only thing that catches that before integration day.

## Recommended sequencing per dev (Phase 1)

### Dev 1
1. Finish 1.1 review-cycle (already there).
2. **1.3 + 1.4** in parallel branches.
3. **S0** internal split: own ML stub + API scaffolding + canned-data contract (SP4).
4. **S1A** (8-K transcripts E2E).
5. **S2** (temporal alignment E2E — highest-risk slice; allocate buffer).
6. **S4** (verification + verdict + reasoning trace E2E — largest single slice).
7. **S6-A** (yfinance + cache hardening) + co-own S6-C demo run.
8. Reviewer-of-record for all Dev 2 PRs throughout.

### Dev 2
1. Review 1.1 (workflow + code) so Dev 1 can merge.
2. **1.2 + 1.5 + 1.6** in parallel branches → SP1 schema lock with Dev 1.
3. **2.1 + 2.2** (design tokens + shared specs — fast, before S0-FE).
4. **S0** internal split: own FE shell + DB seed script.
5. **S1B** (10-Q/10-K actuals E2E — parallel with Dev 1's S1A).
6. **S3** (claim extraction E2E — parallel with Dev 1's S2).
7. **S5** (CEO score E2E).
8. **S6-B** (shareable URLs + accessibility audit) + co-own S6-C demo run.
9. Reviewer-of-record for all Dev 1 PRs throughout.

**Wait windows:** Dev 2 may finish S3 before Dev 1 finishes S4 (S3 is smaller). During that window Dev 2 prepares S5 against the canned verdict shape from S0 — when S4 ships, S5 is mostly drop-in. No idle time.

## Risks specific to this team shape

| Risk | Mitigation |
|---|---|
| Dev 2 also acts as designer (no third person) — capacity overload | Slim Epic 2 to 2.1 + 2.2 only; per-feature specs deferred and authored inline with their slice. |
| Vertical slices = both devs touch shared seam files (schema, shared types, EDGAR client) → merge conflicts | Single-owner declarations table in `slices.md`. Other dev requests changes via PR, never edits in-place. |
| Slice ownership creates "no overlap at any moment" but loses some cross-pollination — neither dev sees the whole stack equally | Mandatory workflow review on every PR forces the non-author to exercise the slice end-to-end, building shared understanding. |
| Schema, enum, webhook, or canned-data contract drift between FastAPI and NestJS layers | Sync points SP1–SP4 are gating before S0 merges — no merge without joint sign-off. |
| Workflow review skipped under deadline pressure | Slice is not `done` without both reviews; sprint-status stays `review` until both signed off. |
| S2 (temporal alignment) is the highest-risk slice per PRD; if it slips, Dev 2's S3 still ships independently but S4 can't start | Dev 2 uses any extra wait time to start S5 prep against S0 canned verdicts. Do not start S4 early on Dev 2's side — S4 is single-owner Dev 1. |

---

## Appendix A — Phase 2 (deferred)

**Trigger:** Phase 1 demo accepted; Phase 1 numerical verdict accuracy ≥78% on 50+ spot-checked claims (per `prd.md:66`).

Stories from `epics.md` FR-coverage map tagged `Deferred P2`:

- **FR7** — Non-US ingestion adapters (BSE/NSE, SGX) — separate format adapters, owned by Dev 1.
- **FR12** — Qualitative + directional claim extraction — extends Epic 4, Dev 1.
- **FR19, FR20, FR21** — `reconcile_definitions()`, `search_subsequent_calls()`, REVISED verdict — extends verification agent, Dev 1.
- **FR25** — Ground-truth dataset records per resolved claim — Dev 1, additive to verdicts table.
- **FR35** — Side-by-side Revised claim display in UI — Dev 2, depends on FR21.

**Suggested Phase 2 ordering**
1. FR19 + FR20 + FR21 (revised-verdict pipeline) — unblocks FR35 and J2/J4.
2. FR12 (qualitative claims) — unblocks J4 fully.
3. FR35 (UI for revisions).
4. FR25 (ground-truth records — passive collection, low risk).
5. FR7 (non-US adapters) — last; legal/sourcing decision required first per `prd.md:139`.

**Plus:** SEO work (ticker pages indexable, meta tags) — Dev 2, frontend.

## Appendix B — Phase 3 (deferred)

**Trigger:** Phase 2 complete; ≥150 ground-truth records collected.

- **FR26** — Multi-LLM benchmark runner — Dev 1, depends on FR25.
- **FR27** — Per-model accuracy metrics — Dev 1.
- **FR42** — LLM leaderboard UI — Dev 2.
- **FR43** — Dataset export — either dev.

**Suggested ordering:** FR26 → FR27 → FR42 ‖ FR43.

Phase 3 is the natural flex point if Phase 1 or 2 runs long, per `prd.md:317`. Benchmark collection (FR25) starts in Phase 2 so the research contribution survives a delayed Phase 3.
