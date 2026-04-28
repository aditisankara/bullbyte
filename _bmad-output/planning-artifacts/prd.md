---
stepsCompleted: [step-01-init, step-02-discovery, step-02b-vision, step-02c-executive-summary, step-03-success, step-04-journeys, step-05-domain, step-06-innovation, step-07-project-type, step-08-scoping, step-09-functional, step-10-nonfunctional, step-11-polish, step-12-complete]
completedAt: '2026-04-26'
releaseMode: phased
inputDocuments: ["BullByte_Project_Overview.pdf (provided inline by user)"]
workflowType: 'prd'
classification:
  projectType: web_app
  domain: fintech
  complexity: high
  projectContext: greenfield
  uiApproach: structural-blueprint-only
---

# Product Requirements Document - BullByte

**Author:** Aditi
**Date:** 2026-04-26

## Executive Summary

BullByte is a promise-tracking system for public companies. It ingests earnings call transcripts from SEC EDGAR, extracts every forward-looking statement made by executives, and verifies each claim against the actual financial outcomes reported in subsequent filings. The result is a per-company, per-quarter record of what was promised and what was delivered — surfaced as a CEO Delivery Score with a fully auditable reasoning trail behind every verdict.

The primary user is the retail investor: analytically curious, time-constrained, and structurally disadvantaged relative to institutional players who track this manually. Secondary users — finance students and journalists — are served by the same core product. All three share the same need: a trustworthy, evidence-backed answer to "can I trust this management team?"

BullByte does not tell users what to buy or sell. It tells users what management said, what happened, and whether those two things matched.

### What Makes This Special

The market has tools that summarise earnings calls. BullByte is the only tool that cross-examines them across time.

The core technical differentiator is the Agentic Verification Engine: an LLM agent that reasons across multiple quarters of SEC EDGAR filings, reconciles definition and segment changes over time, detects silent claim revisions in later calls, and produces a structured verdict — Delivered, Missed, Revised, or Insufficient Data — with every tool call and reasoning step visible to the user. The reasoning trace is the trust mechanism. Users can see exactly why BullByte reached each verdict.

The CEO Delivery Score is designed as "transparent authority": institutional weight, with every number explainable in plain language beneath it. No black boxes.

As a byproduct of resolving historical claims, BullByte generates a ground truth dataset of verified financial promises and verdicts — an original benchmark and publishable research contribution on LLM temporal reasoning over financial filings.

## Project Classification

| Attribute | Value |
|---|---|
| **Project Type** | Web application (Angular SPA + Node.js API + Python/FastAPI ML sidecar) |
| **Domain** | Fintech — investment analysis, SEC filing ingestion, executive accountability |
| **Complexity** | High — multi-quarter temporal reasoning, agentic tool-calling, multi-model benchmarking, PostgreSQL persistence |
| **Project Context** | Greenfield |
| **UI Approach** | Structural blueprint — components and layout specified; visual design owned by UI designer |

## Success Criteria

### User Success

- A user searches any supported ticker and receives a promise timeline within **3 minutes for a fresh pull** and **under 30 seconds for a cached ticker**
- Each claim card is self-explanatory: verdict, delta (where applicable), and reasoning trace readable without a tutorial
- The CEO Delivery Score communicates credibility at a glance; clicking through reveals the exact claims and outcomes behind the number
- A retail investor with no finance training can distinguish a Delivered from a Missed claim and understand why BullByte reached that verdict

### Business Success

- **Phase 1 demo:** ≥5 well-known US tickers fully processed end-to-end (TSLA, AAPL, SPOT, META, NVDA) — sufficient for a job interview or professor demo
- **Phase 2:** Any S&P 500 ticker analysable on demand without manual intervention
- **Phase 3:** Benchmark dataset published; LLM leaderboard live and presentable as a research contribution
- **Production release:** Publicly accessible deployment with legal disclaimer; codebase clean enough for open-source release

### Technical Success

- Numerical claim verdict accuracy: **≥78%** in Phase 1, **≥88%** in Phase 2 (evaluated on ≥50 manually spot-checked claims per phase)
- Qualitative claim verdict accuracy: **≥70%** in Phase 2 (Phase 1 does not attempt qualitative claims)
- EDGAR pipeline reliably ingests 8-K, 10-Q, and 10-K filings for all S&P 500 tickers
- Every tool call logged, every decision auditable — no silent failures
- Concurrent analysis requests produce no data corruption or race conditions in PostgreSQL

### Measurable Outcomes

- End-to-end demo flow (search → timeline → claim detail → score) completable in under 5 minutes for a new user
- Phase 1 benchmark: ≥50 verified claim-verdict pairs across ≥5 tickers
- Phase 3 benchmark: ≥300 verified claim-verdict pairs, 3 LLMs evaluated

## User Journeys

### Journey 1: The Retail Investor — Happy Path

**Meet Priya.** She's a 34-year-old software engineer who invests her own money on weekends. She doesn't pay for Bloomberg. Last quarter she bought Palantir after the CEO talked confidently about revenue targets on the earnings call — and watched the stock drop when reality disappointed.

She opens BullByte and types `PLTR`. A promise timeline appears spanning 8 quarters — colour-coded, chronological, immediate. She clicks on a Q2 2024 claim: *"We expect revenue of $380M in Q3."* BullByte shows the actual figure ($372M), the delta (-2.1%), the verdict: **Missed**, and a reasoning trace showing exactly which 10-Q it pulled, which line item it matched, and how it calculated the gap.

At the top: **CEO Delivery Score: 6/10 numerical promises delivered.** Not a gut feeling. A record.

Priya bookmarks three tickers before lunch ends. No tutorial. No sign-up.

**Requirements revealed:** Ticker search, promise timeline, claim detail (verdict + delta + reasoning trace), CEO Delivery Score with plain-language breakdown, no-login access.

### Journey 2: The Retail Investor — Edge Case (Pending Claims + Sparse History)

**Meet James.** He searches a company that listed 18 months ago. BullByte returns a timeline with only 2 quarters of resolved claims. Three more are marked **Pending** — the verdict quarter hasn't arrived yet.

One claim is marked **Revised**: the CEO quietly changed a revenue target in the following quarter's call. BullByte caught it.

The score shows: *"2 of 2 resolved numerical claims delivered. 3 claims pending verdict."* Honest about its own limitations. James understands what he's looking at and checks back next quarter.

**Requirements revealed:** Pending verdict state, Revised verdict status, CEO Delivery Score with sample-size context, graceful handling of companies with <4 quarters of history.

### Journey 3: The Finance Student — Academic Deep Dive

**Meet Rohan.** He's writing a thesis on management credibility across the tech sector. He needs structured, citable data.

He pulls promise timelines for 10 S&P 500 companies over 8 quarters. For each claim, he clicks through to the source EDGAR filing — the 8-K or 10-Q BullByte used to reach its verdict. He can cite the primary source, not BullByte itself. The confidence score per verdict lets him filter for high-confidence data. The disclaimer footer — *"Not financial advice. Data sourced from public SEC filings."* — tells him exactly what BullByte is and isn't.

**Requirements revealed:** Direct EDGAR source filing links per claim, confidence score per verdict, disclaimer footer, sequential multi-ticker browsing.

### Journey 4: The Journalist — Investigating a Specific Executive

**Meet Sarah.** She's writing about a CEO who promised a product launch three times across three consecutive quarters and delivered zero times.

She searches the ticker and sees the timeline immediately. Three product launch claims — all **Missed** or **Revised**. Each has the exact quote, the quarter, and what happened. One was quietly revised down; BullByte shows the original and the revision side by side. She has her receipts without manually pulling three quarters of transcripts.

**Requirements revealed:** Qualitative claim handling *(Phase 2)*, side-by-side revision view *(Phase 2)*, exact quote with speaker attribution, quarter-by-quarter navigation.

### Journey Requirements Summary

| Capability | Revealed By | Phase |
|---|---|---|
| Ticker search with fast response | Journey 1 | Phase 1 |
| Chronological promise timeline (8 quarters) | Journey 1 | Phase 1 |
| Claim detail: verdict, delta, reasoning trace | Journey 1 | Phase 1 |
| CEO Delivery Score with sample-size context | Journey 1, 2 | Phase 1 |
| Pending verdict state | Journey 2 | Phase 1 |
| Revised verdict with original vs. revision | Journey 2, 4 | Phase 2 |
| No-login access | Journey 1 | Phase 1 |
| Direct EDGAR source filing links per claim | Journey 3 | Phase 1 |
| Confidence score per verdict | Journey 3 | Phase 1 |
| Disclaimer footer | Journey 3 | Phase 1 |
| Qualitative claim handling | Journey 4 | Phase 2 |
| Speaker attribution per quote | Journey 4 | Phase 1 |

## Domain-Specific Requirements

### Compliance & Regulatory

- **Data sourcing**: All ingested data must originate from SEC EDGAR public domain filings (8-K, 10-Q, 10-K) for Phase 1. Paid or licensed transcript services (Seeking Alpha, Bloomberg, Motley Fool) are prohibited. Non-US market data sourcing decision is deferred to Phase 2.
- **Investment advice prohibition**: All user-facing surfaces carry the disclaimer: *"Not financial advice. Data sourced from public SEC filings."* This appears persistently in the footer and on any page displaying verdicts or scores.
- **Verdict accuracy liability**: Low-confidence verdicts are visually flagged — not suppressed. BullByte is a research tool, not a financial authority.
- **yfinance usage**: Acceptable at portfolio/demo scale. Transition to an official financial data provider required before commercial-scale launch.

### Transparency Requirements

- **Inline source citations in reasoning traces**: Every factual statement in a reasoning trace includes a citation linking to the exact SEC filing (type, company, quarter, section) from which that fact was drawn. Citations appear inline — not only as a separate source link at the claim level. This is the primary trust mechanism.
- **Confidence score visibility**: Every verdict displays its confidence score. Claims below a defined threshold (set in Phase 2 evaluation) are labelled low-confidence in the UI.
- **Reasoning trace completeness**: Every verification agent tool call is logged and displayable. No silent tool calls, no suppressed steps.
- **Revision disclosure**: When a claim is marked Revised, BullByte shows the original quote and the revised quote with the quarter of each.

### Technical Constraints

- **SEC EDGAR rate limits**: The pipeline must respect EDGAR's ~10 requests/second limit. All calls are queued and throttled. Bulk ingestion runs are scheduled to avoid exceeding session limits.
- **No user data collection**: No authentication, no accounts, no PII storage. GDPR and data privacy exposure is eliminated for Phase 1. Any post-MVP user features require a privacy review before launch.
- **Data immutability**: Verdicts are never silently overwritten. Corrections create a new record with a correction flag — the original is preserved.

### Domain Risk Mitigations

| Risk | Mitigation |
|---|---|
| Incorrect verdict misleads an investor | Confidence score shown; low-confidence flagged; disclaimer on all pages; reasoning trace auditable |
| EDGAR rate limit exceeded → IP block | Request queue with throttling; exponential backoff on 429 responses |
| Definition drift creates false Missed verdict | `reconcile_definitions()` in Phase 2; Phase 1 flags definitional ambiguity as low-confidence |
| Non-US data sourcing introduces licensing risk | Deferred to Phase 2 with explicit sourcing decision gate before implementation |
| yfinance ToS at production scale | Monitored; fallback data provider identified before Phase 2 public launch |

## Innovation & Novel Patterns

### Detected Innovation Areas

**1. Agentic cross-time financial reasoning**
The standard finance AI approach is single-document RAG: retrieve, summarise, return. BullByte's verification agent reasons *across* multiple quarters — tracking what was said when, what changed, and whether reality matched. This requires temporal alignment, definition reconciliation, and revision detection. No existing consumer finance tool does this.

**2. Verdict with receipts — auditable AI reasoning**
Most AI-generated financial analysis is a black box. BullByte makes every reasoning step visible: which filing was fetched, which metric extracted, how the delta was calculated, what confidence was assigned. The inline citation model (Perplexity-style, within the reasoning trace) makes every verdict granularly auditable.

**3. Living benchmark dataset as a product byproduct**
Every resolved claim-verdict pair is a ground truth record. Over time this becomes an original benchmark dataset for evaluating LLM temporal reasoning over financial filings — a publishable research contribution generated as a natural side effect of being a useful product.

**4. Executive accountability as a product category**
This is a new category, not a new feature in an existing one. The closest analogues (Glassdoor, credit scores) measure reputation or creditworthiness — not promise delivery. BullByte creates a new primitive: the CEO Delivery Score.

### Market Context & Competitive Landscape

| Existing Tool | What it does | Why BullByte is different |
|---|---|---|
| Earnings call summary tools (e.g., Quartr) | Summarise a single transcript | No cross-quarter reasoning, no verification |
| Financial chatbots (e.g., FinChat) | RAG over filings, answers questions | Single-document, no verdict, no ground truth |
| Bloomberg/Refinitiv terminals | Comprehensive financial data | Expensive, institutional, no promise tracking |
| Manual analyst research | Tracks guidance vs. actuals | Not scalable, not accessible, not public |

### Validation Approach

- **Phase 1**: Manually spot-check 50+ verdicts across 5 well-known tickers against publicly known outcomes. This is the ground truth seeding process.
- **Phase 2**: Grow benchmark to ≥150 records. Measure accuracy against human-reviewed verdicts. Track confidence score calibration.
- **Phase 3**: Run 3 LLMs on the same benchmark. Publish results with reproducible methodology.

### Innovation Risk Mitigations

| Risk | Mitigation |
|---|---|
| EDGAR transcripts inconsistently formatted | Confidence score system; Insufficient Data verdict for parse failures; human-reviewable trace |
| Definition drift causes false Missed verdicts | `reconcile_definitions()` in Phase 2; Phase 1 flags definitional ambiguity explicitly |
| Benchmark too small to be credible for research | Phase 3 targets ≥300 records before publication; methodology documented alongside data |
| Wrong verdict on high-profile company | Confidence scores prominent; disclaimer on all pages; reasoning trace enables user to verify |

## UI & Platform Requirements

BullByte is an Angular SPA delivering a read-only research dashboard. No user authentication, no real-time market data, no transactional functionality. The primary interaction pattern is: search → wait for analysis → browse results. The frontend consumes a Node.js REST API which orchestrates the Python/FastAPI ML sidecar. All displayed data is sourced from historical SEC filings.

### Browser Support

| Browser | Support Level |
|---|---|
| Chrome (last 2 versions) | Full |
| Firefox (last 2 versions) | Full |
| Edge (last 2 versions) | Full |
| Safari (last 2 versions) | Full |
| IE11 / legacy browsers | Not supported |

### Responsive Design

- **Desktop (≥1280px)**: Primary experience — full dashboard with timeline, claim detail panel, and score card visible simultaneously
- **Tablet (768px–1279px)**: Usable — layout adapts, all content accessible, panels may stack vertically
- **Mobile (<768px)**: Readable — content legible and accessible; full mobile UX not required, but nothing broken or unreadable on a phone
- No PWA requirement for Phase 1

### Analysis Progress Feed

When a user searches a ticker not yet cached, the UI displays a live step-by-step agent progress feed:
- *"Locating earnings call transcripts for TSLA..."*
- *"Found 8 quarterly 8-K filings. Extracting forward-looking statements..."*
- *"Extracted 14 claims from Q3 2024 transcript. Verifying claim 1 of 14..."*
- *"Verification complete. Building CEO Delivery Score..."*

The feed updates as each agent step completes. It is the primary UX mechanism for managing wait time and reinforcing transparency.

### SEO Strategy

- **Phase 1**: No SEO investment. The tool is in validation mode — not ready for organic discovery.
- **Phase 2**: Ticker pages become indexable (e.g., `/company/TSLA`). Meta tags, page titles, and Open Graph tags added. Goal: organic discovery via searches like "Tesla CEO credibility" or "Palantir earnings promises."

### Implementation Architecture

- **Routing**: Each ticker has a stable URL (`/company/:ticker`) — shareable and bookmarkable
- **State**: Claim detail view state held in URL params so users can share direct links to a specific claim
- **Rendering**: Client-side only for Phase 1; SSR considered in Phase 2 alongside SEO work
- **API boundary**: Angular → Node.js API → Python FastAPI sidecar. Frontend never calls the ML sidecar directly
- **Error states**: Ticker not found, EDGAR filing unavailable, agent timeout, and low-confidence verdict all have explicit UI states — no silent failures

## Project Scoping & Phased Development

### MVP Strategy

**Approach:** Problem-solving MVP — Phase 1 proves that BullByte can correctly extract and verify numerical promises from SEC filings for a curated set of well-known US tickers. The goal is a validated pipeline with a working end-to-end demo, not a polished product.

**Team:**
- 2 developers (backend/ML pipeline + frontend/API)
- 1 beginner UI designer working with Claude design tooling — responsible for the visual layer over the structural blueprint in this PRD
- Friends and peers for usability feedback and verdict accuracy spot-checking

### Phase 1 — Foundation (Month 1)

**Journeys supported:** Journey 1 (retail investor, happy path), Journey 3 (finance student, source links)

**Must-Have Capabilities:**
- SEC EDGAR ingestion: 8-K earnings call transcripts + 10-Q/10-K financials for US-listed companies
- Numerical claim extraction — forward-looking statements with a verifiable metric and timeframe
- Verdict logic: Delivered / Missed / Insufficient Data for numerical claims
- Temporal alignment engine: quarter-to-filing mapping with explicit logging at every step
- CEO Delivery Score with plain-language context and sample-size disclosure
- Step-by-step analysis progress feed in the UI
- Claim detail: exact quote, verdict, delta, confidence score, inline EDGAR source citation, speaker attribution
- Stable shareable URLs per ticker and per claim
- PostgreSQL caching of processed claims and verdicts
- Legal disclaimer footer
- Demo-ready with ≥5 US tickers (TSLA, AAPL, SPOT, META, NVDA)

**Out of Phase 1:**
- Qualitative and directional claim handling
- Revised verdict status and revision detection
- Reasoning trace display in UI
- SEO optimisation
- Non-US markets

### Phase 2 — Intelligence (Month 2)

**Dependency:** Phase 1 pipeline stable and producing ≥78% accurate numerical verdicts

- Full agentic verification: `reconcile_definitions()`, `search_subsequent_calls()` tools active
- Revised verdict with side-by-side original vs. revision display
- Reasoning trace surfaced in UI — expandable per claim, every tool call logged
- Qualitative and directional claim handling (product launches, market expansion, margin guidance)
- Ground truth dataset collection begins (human-reviewed verdict pairs)
- Non-US market pipeline: India (BSE/NSE) and Singapore (SGX) — separate ingestion adapters
- SEO: ticker pages indexable, meta tags, Open Graph
- Any S&P 500 ticker analysable on demand

### Phase 3 — Research Layer (Month 3)

**Dependency:** Phase 2 complete; ≥150 ground truth records in benchmark dataset

- Multi-model benchmarking: GPT-4o, Claude Sonnet, open-source model on same dataset
- LLM leaderboard: accuracy by claim type, model, and quarter — publishable
- Pattern analysis: which claim types confuse all models
- Dataset exportable for external research
- Blog post or short workshop paper drafted

### Development Risk Register

| Risk | Priority | Mitigation |
|---|---|---|
| Temporal alignment — silent cross-document failures, hardest to debug | Highest | Build as an explicit, fully-logged module from day one. Uncertain alignments produce Insufficient Data, never a silent wrong mapping. |
| EDGAR document parsing — inconsistent structure across companies and years | Medium | Per-company format detection; fallback to Insufficient Data on parse failure. Phase 1 prioritises the 5 demo tickers before generalising. |
| Claim extraction from hedged language — real but iteratively solvable | Medium | Iterative prompt engineering on Phase 1 demo tickers. Confidence scoring surfaces uncertain extractions. |
| Qualitative verification — real but scoped out | Resolved | Explicitly deferred to Phase 2. |
| Resource constraints — 2 devs, 3 months | Ongoing | Phase 3 is the natural flex point if Phase 1 runs long. Benchmark collection begins in Phase 2, so research contribution survives a delayed Phase 3. |

## Functional Requirements

### Data Ingestion & Pipeline

- **FR1** [P1]: The system can fetch earnings call transcripts from SEC EDGAR 8-K filings for a given US ticker and date range
- **FR2** [P1]: The system can fetch financial actuals (revenue, EPS, margins, guidance) from SEC EDGAR 10-Q/10-K filings for a given ticker and quarter
- **FR3** [P1]: The system can align each earnings call to its corresponding subsequent reporting quarter's actuals
- **FR4** [P1]: The system can log every temporal alignment decision — including uncertainty — for every quarter-to-filing mapping
- **FR5** [P1]: The system can cache processed transcripts, extracted claims, and verdicts in persistent storage to avoid re-ingestion
- **FR6** [P1]: The system can supplement EDGAR financials with data from an alternative financial data source (yfinance)
- **FR7** [P2]: The system can ingest filings from non-US markets (BSE/NSE, SGX) via separate format adapters

### Claim Extraction

- **FR8** [P1]: The system can extract forward-looking numerical claims from earnings call transcripts as structured objects
- **FR9** [P1]: Each extracted claim captures: raw quote, claim type, metric, timeframe, speaker attribution, and extraction confidence
- **FR10** [P1]: The system can distinguish genuine forward-looking commitments from safe-harbour boilerplate language
- **FR11** [P1]: The system can assign an extraction confidence score to each claim indicating how clearly it was stated
- **FR12** [P2]: The system can extract qualitative and directional claims (product launches, market expansion, margin guidance)

### Claim Verification

- **FR13** [P1]: The system can produce a verdict (Delivered / Missed / Insufficient Data) for each resolved numerical claim
- **FR14** [P1]: The system can calculate the quantitative delta between a claimed value and an actual reported value
- **FR15** [P1]: The verification agent can fetch a specific SEC filing from EDGAR on demand during verification
- **FR16** [P1]: The verification agent can extract a specific metric or statement from a target filing
- **FR17** [P1]: The system can log every verification tool call and decision step as a structured, ordered reasoning trace
- **FR18** [P1]: The system can assign a confidence score to each verdict indicating verification certainty
- **FR19** [P2]: The verification agent can check whether a term or metric is defined consistently across two quarters
- **FR20** [P2]: The verification agent can search subsequent earnings calls to detect if a claim was silently revised
- **FR21** [P2]: The system can produce a Revised verdict when a claim is confirmed to have been changed in a later call

### CEO Delivery Score & Analytics

- **FR22** [P1]: The system can compute a CEO Delivery Score aggregating all resolved claims for a given company
- **FR23** [P1]: The CEO Delivery Score is presented with sample-size context, not as a raw number alone
- **FR24** [P1]: The system can display how the CEO Delivery Score has changed over time
- **FR25** [P2]: The system can generate a structured ground truth record for each resolved claim for benchmark use
- **FR26** [P3]: The system can evaluate multiple LLMs against the same claim-verdict benchmark and record results
- **FR27** [P3]: The system can compute per-model accuracy metrics broken down by claim type and quarter

### Search & Discovery

- **FR28** [P1]: Users can search for a company by stock ticker symbol
- **FR29** [P1]: Users can access any previously analysed ticker via a stable, shareable URL
- **FR30** [P1]: Users can browse a company's full promise history without creating an account or logging in

### Promise Timeline & Navigation

- **FR31** [P1]: Users can view a chronological promise timeline spanning up to 8 quarters for a given company
- **FR32** [P1]: Each claim on the timeline displays its verdict status visually, colour-coded by outcome
- **FR33** [P1]: Users can focus the timeline on a specific quarter
- **FR34** [P1]: Users can see a live step-by-step progress feed while a fresh ticker is being analysed for the first time
- **FR35** [P2]: Claims marked Revised display the original promise and the revised version side-by-side with quarter attribution

### Claim Detail & Transparency

- **FR36** [P1]: Users can view the exact raw quote for any claim, with speaker attribution and source quarter
- **FR37** [P1]: Users can view the verdict, quantitative delta, and confidence score for any resolved claim
- **FR38** [P1]: Users can access a direct link to the source SEC EDGAR filing for any claim
- **FR39** [P1]: Users can view the full reasoning trace for any verified claim, with inline citations to specific source filings
- **FR40** [P1]: Low-confidence verdicts are visually distinguished from high-confidence verdicts
- **FR41** [P1]: Users can share a direct link to a specific claim's detail view

### Research & Benchmarking

- **FR42** [P3]: Users can view a model leaderboard comparing LLM accuracy by claim type and quarter
- **FR43** [P3]: The benchmark dataset (claim-verdict pairs with ground truth) can be exported for external research use

### Compliance & Legal

- **FR44** [P1]: All user-facing pages display the legal disclaimer: *"Not financial advice. Data sourced from public SEC filings."*
- **FR45** [P1]: Once written to storage, verdicts are immutable; corrections create new records with correction flags, preserving the original

## Non-Functional Requirements

### Performance

- **NFR1**: Fresh ticker analysis (uncached) completes within 3 minutes under normal load
- **NFR2**: Cached ticker — full promise timeline loads within 30 seconds
- **NFR3**: Initial SPA shell loads within 2 seconds on a broadband connection
- **NFR4**: Claim detail view opens and closes instantly (client-side, no additional API calls)
- **NFR5**: The analysis progress feed updates within 5 seconds of each agent step completing — no long silences during a live analysis run
- **NFR6**: Slow or failed EDGAR responses produce an Insufficient Data verdict, not a crash or silent hang

### Reliability & Data Integrity

- **NFR7**: A verdict once written to the database is never silently overwritten — corrections produce a new versioned record
- **NFR8**: Every temporal alignment decision is logged with its inputs and output — no silent mapping failures
- **NFR9**: Every EDGAR fetch attempt is logged with its result (success, timeout, parse failure) — no silent data gaps
- **NFR10**: Failed EDGAR requests are retried with exponential backoff before an Insufficient Data verdict is issued
- **NFR11**: Concurrent analysis requests for different tickers produce no data corruption or race conditions in PostgreSQL

### Security

- **NFR12**: All LLM API keys (Anthropic, OpenAI) are stored as environment variables — never hardcoded or committed to source control
- **NFR13**: The database is not exposed to the public internet — only the Node.js API layer communicates with PostgreSQL
- **NFR14**: All inter-service communication (Angular → Node.js API → Python FastAPI) occurs over internal network interfaces in the Docker environment
- **NFR15**: No user PII is collected, stored, or logged at any layer

### Integration

- **NFR16**: All SEC EDGAR requests respect the ~10 requests/second rate limit — enforced by a request queue in the ingestion pipeline
- **NFR17**: The LLM provider is swappable — the verification agent's tool-calling layer is not tightly coupled to a single provider's API format
- **NFR18**: LLM API costs per ticker analysis are logged; cost thresholds are monitored and configurable per deployment
- **NFR19**: yfinance calls are limited to portfolio-scale volume; a fallback data provider is identified before Phase 2 public launch

### Accessibility

- **NFR20**: All pages use semantic HTML — correct heading hierarchy, landmark regions, list and table elements
- **NFR21**: All interactive elements (search input, claim cards, navigation) are keyboard-navigable and focusable
- **NFR22**: Verdict status indicators are distinguished by both colour and a text label — never colour alone
- **NFR23**: The application is legible and functional on mobile screen sizes (≥320px width) without horizontal scrolling
