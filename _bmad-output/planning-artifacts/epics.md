---
stepsCompleted: [step-01-validate-prerequisites, step-02-design-epics, step-03-create-stories, step-04-final-validation]
inputDocuments:
  - "_bmad-output/planning-artifacts/prd.md"
  - "_bmad-output/planning-artifacts/architecture.md"
---

# BullByte - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for BullByte, decomposing the requirements from the PRD and Architecture requirements into implementable stories.

## Requirements Inventory

### Functional Requirements

**Data Ingestion & Pipeline**
FR1 [P1]: The system can fetch earnings call transcripts from SEC EDGAR 8-K filings for a given US ticker and date range
FR2 [P1]: The system can fetch financial actuals (revenue, EPS, margins, guidance) from SEC EDGAR 10-Q/10-K filings for a given ticker and quarter
FR3 [P1]: The system can align each earnings call to its corresponding subsequent reporting quarter's actuals
FR4 [P1]: The system can log every temporal alignment decision — including uncertainty — for every quarter-to-filing mapping
FR5 [P1]: The system can cache processed transcripts, extracted claims, and verdicts in persistent storage to avoid re-ingestion
FR6 [P1]: The system can supplement EDGAR financials with data from an alternative financial data source (yfinance)
FR7 [P2]: The system can ingest filings from non-US markets (BSE/NSE, SGX) via separate format adapters

**Claim Extraction**
FR8 [P1]: The system can extract forward-looking numerical claims from earnings call transcripts as structured objects
FR9 [P1]: Each extracted claim captures: raw quote, claim type, metric, timeframe, speaker attribution, and extraction confidence
FR10 [P1]: The system can distinguish genuine forward-looking commitments from safe-harbour boilerplate language
FR11 [P1]: The system can assign an extraction confidence score to each claim indicating how clearly it was stated
FR12 [P2]: The system can extract qualitative and directional claims (product launches, market expansion, margin guidance)

**Claim Verification**
FR13 [P1]: The system can produce a verdict (Delivered / Missed / Insufficient Data) for each resolved numerical claim
FR14 [P1]: The system can calculate the quantitative delta between a claimed value and an actual reported value
FR15 [P1]: The verification agent can fetch a specific SEC filing from EDGAR on demand during verification
FR16 [P1]: The verification agent can extract a specific metric or statement from a target filing
FR17 [P1]: The system can log every verification tool call and decision step as a structured, ordered reasoning trace
FR18 [P1]: The system can assign a confidence score to each verdict indicating verification certainty
FR19 [P2]: The verification agent can check whether a term or metric is defined consistently across two quarters
FR20 [P2]: The verification agent can search subsequent earnings calls to detect if a claim was silently revised
FR21 [P2]: The system can produce a Revised verdict when a claim is confirmed to have been changed in a later call

**CEO Delivery Score & Analytics**
FR22 [P1]: The system can compute a CEO Delivery Score aggregating all resolved claims for a given company
FR23 [P1]: The CEO Delivery Score is presented with sample-size context, not as a raw number alone
FR24 [P1]: The system can display how the CEO Delivery Score has changed over time
FR25 [P2]: The system can generate a structured ground truth record for each resolved claim for benchmark use
FR26 [P3]: The system can evaluate multiple LLMs against the same claim-verdict benchmark and record results
FR27 [P3]: The system can compute per-model accuracy metrics broken down by claim type and quarter

**Search & Discovery**
FR28 [P1]: Users can search for a company by stock ticker symbol
FR29 [P1]: Users can access any previously analysed ticker via a stable, shareable URL
FR30 [P1]: Users can browse a company's full promise history without creating an account or logging in

**Promise Timeline & Navigation**
FR31 [P1]: Users can view a chronological promise timeline spanning up to 8 quarters for a given company
FR32 [P1]: Each claim on the timeline displays its verdict status visually, colour-coded by outcome
FR33 [P1]: Users can focus the timeline on a specific quarter
FR34 [P1]: Users can see a live step-by-step progress feed while a fresh ticker is being analysed for the first time
FR35 [P2]: Claims marked Revised display the original promise and the revised version side-by-side with quarter attribution

**Claim Detail & Transparency**
FR36 [P1]: Users can view the exact raw quote for any claim, with speaker attribution and source quarter
FR37 [P1]: Users can view the verdict, quantitative delta, and confidence score for any resolved claim
FR38 [P1]: Users can access a direct link to the source SEC EDGAR filing for any claim
FR39 [P1]: Users can view the full reasoning trace for any verified claim, with inline citations to specific source filings
FR40 [P1]: Low-confidence verdicts are visually distinguished from high-confidence verdicts
FR41 [P1]: Users can share a direct link to a specific claim's detail view

**Research & Benchmarking**
FR42 [P3]: Users can view a model leaderboard comparing LLM accuracy by claim type and quarter
FR43 [P3]: The benchmark dataset (claim-verdict pairs with ground truth) can be exported for external research use

**Compliance & Legal**
FR44 [P1]: All user-facing pages display the legal disclaimer: "Not financial advice. Data sourced from public SEC filings."
FR45 [P1]: Once written to storage, verdicts are immutable; corrections create new records with correction flags, preserving the original

### NonFunctional Requirements

**Performance**
NFR1: Fresh ticker analysis (uncached) completes within 3 minutes under normal load
NFR2: Cached ticker — full promise timeline loads within 30 seconds
NFR3: Initial SPA shell loads within 2 seconds on a broadband connection
NFR4: Claim detail view opens and closes instantly (client-side, no additional API calls)
NFR5: The analysis progress feed updates within 5 seconds of each agent step completing — no long silences during a live analysis run
NFR6: Slow or failed EDGAR responses produce an Insufficient Data verdict, not a crash or silent hang

**Reliability & Data Integrity**
NFR7: A verdict once written to the database is never silently overwritten — corrections produce a new versioned record
NFR8: Every temporal alignment decision is logged with its inputs and output — no silent mapping failures
NFR9: Every EDGAR fetch attempt is logged with its result (success, timeout, parse failure) — no silent data gaps
NFR10: Failed EDGAR requests are retried with exponential backoff before an Insufficient Data verdict is issued
NFR11: Concurrent analysis requests for different tickers produce no data corruption or race conditions in PostgreSQL

**Security**
NFR12: All LLM API keys (Anthropic, OpenAI) are stored as environment variables — never hardcoded or committed to source control
NFR13: The database is not exposed to the public internet — only the Node.js API layer communicates with PostgreSQL
NFR14: All inter-service communication (Angular → Node.js API → Python FastAPI) occurs over internal network interfaces in the Docker environment
NFR15: No user PII is collected, stored, or logged at any layer

**Integration**
NFR16: All SEC EDGAR requests respect the ~10 requests/second rate limit — enforced by a request queue in the ingestion pipeline
NFR17: The LLM provider is swappable — the verification agent's tool-calling layer is not tightly coupled to a single provider's API format
NFR18: LLM API costs per ticker analysis are logged; cost thresholds are monitored and configurable per deployment
NFR19: yfinance calls are limited to portfolio-scale volume; a fallback data provider is identified before Phase 2 public launch

**Accessibility**
NFR20: All pages use semantic HTML — correct heading hierarchy, landmark regions, list and table elements
NFR21: All interactive elements (search input, claim cards, navigation) are keyboard-navigable and focusable
NFR22: Verdict status indicators are distinguished by both colour and a text label — never colour alone
NFR23: The application is legible and functional on mobile screen sizes (≥320px width) without horizontal scrolling

### Additional Requirements

From Architecture — technical requirements that impact implementation:

- **Starter Template (Greenfield):** Three services scaffolded separately via their respective CLI tools, then composed via Docker Compose. Service initialization is the first story in each service's epic.
  - Frontend: `ng new frontend --routing --strict --ssr=false --style=scss` (Angular 21)
  - API: `nest new api --package-manager npm` (NestJS)
  - ML Sidecar: `uv init ml-sidecar && uv add fastapi uvicorn pydantic` (FastAPI + uv)

- **Infrastructure:** Docker Compose required as the composition layer. Services: `frontend` (port 4200), `api` (port 3000), `ml-sidecar` (port 8000), `db` (PostgreSQL 16, port 5432), `redis` (Redis 7, port 6379). All inter-service traffic is on Docker internal network; only NestJS API is internet-reachable.

- **Database:** NestJS owns all Drizzle schema definitions and runs Drizzle Kit migrations at startup before accepting requests. FastAPI writes directly via asyncpg with no competing ORM. Append-only schema enforced at the schema level — no `updated_at` on verdict tables.

- **Redis:** Required as BullMQ backing store for async job queue. Added to Docker Compose. NestJS JobModule depends on Redis being healthy before starting.

- **Real-time progress:** SSE (Server-Sent Events) from NestJS to Angular. FastAPI calls `POST /internal/jobs/:jobId/progress` webhook on NestJS after each agent step; NestJS relays to the SSE stream for that job. Angular uses native `EventSource` API.

- **LLM Abstraction Layer:** `ml-sidecar/src/core/llm/base.py` defines the provider interface. `verification_service.py` and `extraction_service.py` import only from `base.py`. Provider injected via config — no direct imports of provider modules from business logic.

- **Canonical Enums — must be consistent across all services and DB:**
  - Verdict values: `"DELIVERED"` | `"MISSED"` | `"REVISED"` | `"PENDING"` | `"INSUFFICIENT_DATA"` (SCREAMING_SNAKE_CASE)
  - Job status: `"QUEUED"` | `"RUNNING"` | `"COMPLETED"` | `"FAILED"` (SCREAMING_SNAKE_CASE)
  - Quarter format: `"Q3-2024"` kebab string — never any other representation
  - Confidence score: `number` 0–1 (e.g. `0.87`) — never percentage or string

- **MlSidecarService boundary:** All NestJS → FastAPI calls go through a single `MlSidecarService` in `api/src/common/ml-sidecar.service.ts`. No other NestJS module calls the sidecar directly.

- **EDGAR Rate Limiting:** `edgar_client.py` enforces ≤10 req/s with a persistent queue. `tenacity` provides exponential backoff (max 3 attempts, 30s max wait) before issuing `INSUFFICIENT_DATA` verdict.

- **CI/CD:** GitHub Actions — lint + type-check + unit tests on PR; build check on merge to main. Migrations run at api service startup (Docker Compose command), not in CI.

- **Deployment (Phase 1):** Railway — deploys Docker Compose directly; PostgreSQL and Redis add-ons available.

- **Logging:** Structured JSON logs with `{ level, message, service, timestamp, jobId?, ticker?, traceId? }` required for all services. Winston in NestJS, `python-json-logger` in FastAPI. No `console.log` in production code.

### UX Design Requirements

No UX Design document was present. UX requirements are captured within the PRD:

UX-DR1: The analysis progress feed must display step-by-step messages (e.g. "Locating earnings call transcripts for TSLA...", "Verified claim 3 of 14...") updating within 5 seconds of each agent step completing
UX-DR2: Promise timeline must be chronological, spanning up to 8 quarters, with verdict status colour-coded AND text-labelled (never colour alone) — accessible to users who cannot distinguish colours
UX-DR3: Claim detail panel must display: exact raw quote with speaker attribution, verdict badge, quantitative delta, confidence score, inline EDGAR source link, and full reasoning trace with inline citations
UX-DR4: CEO Delivery Score must include sample-size context (e.g. "6 of 10 resolved numerical promises delivered — 3 pending") — not a raw number alone
UX-DR5: Low-confidence verdicts must be visually flagged (distinct styling from high-confidence) — not suppressed
UX-DR6: Error states must have explicit UI treatment for: ticker not found, EDGAR filing unavailable, agent timeout, and low-confidence verdict — no silent failures or blank screens
UX-DR7: All interactive elements (search input, claim cards, timeline navigation) must be keyboard-navigable; pages must use semantic HTML with correct heading hierarchy
UX-DR8: Primary experience targets desktop (≥1280px) — full dashboard with timeline, claim detail panel, and score card visible simultaneously; tablet (768px–1279px) stacks panels; mobile (≥320px) is readable with no horizontal scrolling
UX-DR9: Stable shareable URL per ticker (`/company/:ticker`) and per claim (URL params for claim detail state) — bookmarkable and linkable without login
UX-DR10: Legal disclaimer "Not financial advice. Data sourced from public SEC filings." must appear persistently in the footer and on all pages displaying verdicts or scores

### Layer Taxonomy

| Tag | Layer | Technology | Primary Owner |
|---|---|---|---|
| `[INFRA]` | Infrastructure | Docker Compose, Dockerfiles, Redis, GitHub Actions, Railway, `.env.example` | Shared |
| `[DB]` | Database | PostgreSQL 16, Drizzle schema + migrations, asyncpg query helpers | Shared |
| `[ML]` | ML Sidecar | FastAPI, EDGAR client, temporal aligner, LLM abstraction, ingestion/extraction/verification/scoring services, Pydantic models | Dev 1 (Backend/ML) |
| `[API]` | NestJS API | Modules, controllers, services, repositories, DTOs, BullMQ job queue, SSE endpoint, webhook receiver, MlSidecarService | Dev 2 (Frontend/API) |
| `[FE]` | Angular SPA | Components, services, routes, Angular Signals, HttpClient, EventSource, SCSS | Dev 2 (Frontend/API) |
| `[DESIGN]` | UI Design | Design tokens, component visual specs, responsive layout specs, accessibility specs, interaction states | Designer |

**Dev split summary:**
- **Dev 1 (Backend/ML):** `[INFRA]` `[DB]` `[ML]`
- **Dev 2 (Frontend/API):** `[INFRA]` `[DB]` `[API]` `[FE]`
- **Designer:** `[DESIGN]`

### FR Coverage Map

| FR | Epic | Description |
|---|---|---|
| FR1 | Epic 3 | Fetch 8-K transcripts from EDGAR |
| FR2 | Epic 3 | Fetch 10-Q/10-K financials from EDGAR |
| FR3 | Epic 3 | Temporal alignment — transcript to actuals quarter |
| FR4 | Epic 3 | Log every temporal alignment decision |
| FR5 | Epic 3 | PostgreSQL caching of processed data |
| FR6 | Epic 3 | yfinance supplement for financial data |
| FR7 | Deferred P2 | Non-US market ingestion adapters |
| FR8 | Epic 4 | Extract forward-looking numerical claims as structured objects |
| FR9 | Epic 4 | Capture raw quote, type, metric, timeframe, speaker, confidence |
| FR10 | Epic 4 | Distinguish genuine commitments from safe-harbour boilerplate |
| FR11 | Epic 4 | Extraction confidence score per claim |
| FR12 | Deferred P2 | Qualitative and directional claim extraction |
| FR13 | Epic 4 | Produce Delivered / Missed / Insufficient Data verdict |
| FR14 | Epic 4 | Calculate quantitative delta (claimed vs actual) |
| FR15 | Epic 4 | Fetch specific EDGAR filing on demand during verification |
| FR16 | Epic 4 | Extract specific metric from target filing |
| FR17 | Epic 4 | Log every verification tool call as structured reasoning trace |
| FR18 | Epic 4 | Confidence score per verdict |
| FR19 | Deferred P2 | Definition consistency check across quarters |
| FR20 | Deferred P2 | Detect silently revised claims in subsequent calls |
| FR21 | Deferred P2 | Revised verdict when claim confirmed changed |
| FR22 | Epic 4 | Compute CEO Delivery Score |
| FR23 | Epic 4 | Present score with sample-size context |
| FR24 | Epic 4 | Score change over time |
| FR25 | Deferred P2 | Ground truth record per resolved claim |
| FR26 | Deferred P3 | Multi-LLM benchmark evaluation |
| FR27 | Deferred P3 | Per-model accuracy metrics by claim type and quarter |
| FR28 | Epic 6 | Ticker search |
| FR29 | Epic 6 | Stable shareable ticker URL (`/company/:ticker`) |
| FR30 | Epic 6 | No login required |
| FR31 | Epic 6 | Chronological 8-quarter promise timeline |
| FR32 | Epic 6 | Colour-coded + text-labelled verdict statuses |
| FR33 | Epic 6 | Focus timeline on specific quarter |
| FR34 | Epics 5+6 | SSE infrastructure (Epic 5) + progress feed UI (Epic 6) |
| FR35 | Deferred P2 | Side-by-side Revised claim display |
| FR36 | Epic 6 | Raw quote with speaker attribution |
| FR37 | Epic 6 | Verdict, delta, confidence score |
| FR38 | Epic 6 | Direct EDGAR source filing link |
| FR39 | Epic 6 | Full reasoning trace with inline citations |
| FR40 | Epic 6 | Low-confidence verdict visual distinction |
| FR41 | Epic 6 | Shareable claim detail URL |
| FR42 | Deferred P3 | LLM leaderboard |
| FR43 | Deferred P3 | Benchmark dataset export |
| FR44 | Epic 6 | Legal disclaimer on all pages |
| FR45 | Epic 5 | Immutable verdict storage with correction flags |

## Epic List

## Epic 1: Project Foundation & Environment Setup

**Layers:** `[INFRA]` `[DB]` `[ML]` `[API]` `[FE]`
**Dev split:** Shared — Dev 1 scaffolds ML sidecar + DB schema; Dev 2 scaffolds NestJS + Angular; both contribute to Docker Compose and `.env.example`

All five services (Angular SPA, NestJS API, FastAPI ML sidecar, PostgreSQL 16, Redis 7) are scaffolded, running, and communicating over the internal Docker network via Docker Compose. The full DB schema is initialized via Drizzle Kit migrations at API startup. CI/CD (GitHub Actions) is active. All environment variables documented in `.env.example`.

**FRs covered:** Architectural requirements (service init commands, Docker Compose, PostgreSQL schema, Redis, GitHub Actions CI/CD, Railway deployment config, structured logging setup)

---

### Story 1.1: Docker Compose Stack & Environment Configuration

As a **developer**,
I want all five services defined in Docker Compose with a documented environment variable configuration,
So that I can start the complete application stack with a single command and verify inter-service connectivity.

**Acceptance Criteria:**

**Given** a developer has cloned the repo and copied `.env.example` to `.env` with valid values
**When** they run `docker compose up`
**Then** all five services start without errors — frontend (4200), api (3000), ml-sidecar (8000), db (5432), redis (6379)
**And** each service's health check passes within 60 seconds

**Given** the stack is running
**When** the api service initializes
**Then** it successfully connects to PostgreSQL via `DATABASE_URL` and Redis via `REDIS_URL` from the environment
**And** a structured JSON log entry confirms each connection

**Given** the stack is running
**When** the api service sends a request to `http://ml-sidecar:8000/health`
**Then** it receives a 200 response — confirming Docker internal network connectivity (NFR14)
**And** the ml-sidecar is not reachable from outside the Docker network

**Given** the repo root
**When** a developer inspects `.env.example`
**Then** all required variables are documented: `DATABASE_URL`, `REDIS_URL`, `LLM_PROVIDER`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `EDGAR_USER_AGENT`, `ML_SIDECAR_URL`, `NESTJS_WEBHOOK_URL`, `LOG_LEVEL`, `THROTTLE_TTL`, `THROTTLE_LIMIT`
**And** no actual secret values appear in `.env.example` or any committed file (NFR12)

---

### Story 1.2: PostgreSQL Schema & Drizzle Migration Infrastructure

As a **developer**,
I want the full PostgreSQL schema defined in Drizzle and migrations running automatically at API startup,
So that all services share a consistent, version-controlled data model that is always applied before any request is handled.

**Acceptance Criteria:**

**Given** the api service starts via Docker Compose
**When** Drizzle Kit runs migrations as the startup command
**Then** all six tables are created: `companies`, `analysis_jobs`, `claims`, `verdicts`, `reasoning_traces`, `tool_call_logs`
**And** all columns, types, constraints, and indexes match `api/src/db/schema.ts`

**Given** the schema is applied
**When** a developer inspects `verdicts`
**Then** it has no `updated_at` column — only `created_at` — enforcing the append-only model at the schema level (NFR7)
**And** corrections are represented by `is_correction BOOLEAN DEFAULT false` and `corrects_verdict_id UUID NULL FK`

**Given** the schema is applied
**When** a developer inspects `claims`
**Then** `quarter` is stored as `TEXT` (format `"Q3-2024"`) and `extraction_confidence` as `NUMERIC` between 0 and 1

**Given** migrations have already run and the api service restarts
**When** Drizzle Kit runs again
**Then** it detects no pending migrations and starts without error
**And** no data loss or duplicate tables occur

**Given** `api/src/db/schema.ts`
**When** a developer adds a new table in a future story
**Then** they generate a migration with `drizzle-kit generate` and it applies cleanly on the next service start

---

### Story 1.3: FastAPI ML Sidecar Scaffold

As a **developer**,
I want the FastAPI ML sidecar scaffolded with a health endpoint, LLM abstraction layer skeleton, and asyncpg connection pool,
So that the NestJS API can verify ML sidecar connectivity and the provider-agnostic LLM interface is ready for the intelligence pipeline.

**Acceptance Criteria:**

**Given** the ml-sidecar service is running
**When** `GET http://ml-sidecar:8000/health` is called
**Then** the response is `{ "status": "ok", "service": "ml-sidecar" }` with HTTP 200

**Given** the ml-sidecar starts
**When** the asyncpg connection pool initializes
**Then** it connects to PostgreSQL using `DATABASE_URL`
**And** a structured JSON log entry is emitted confirming pool readiness with `service: "ml-sidecar"`

**Given** `ml-sidecar/src/core/llm/base.py`
**When** a developer inspects it
**Then** it defines an abstract `BaseLLMProvider` with at minimum a `complete(prompt, tools)` method
**And** `anthropic_provider.py` and `openai_provider.py` each implement `BaseLLMProvider`
**And** the active provider is selected at startup via `LLM_PROVIDER` — no other file imports provider modules directly (NFR17)

**Given** `POST http://ml-sidecar:8000/analyze/{ticker}` (stub)
**When** any ticker value is provided
**Then** the response is `{ "jobId": "stub", "status": "QUEUED" }` with HTTP 202
**And** the endpoint is wired to `analysis_router.py`

**Given** any unhandled exception in the ml-sidecar
**When** it reaches the global exception handler
**Then** the response is `{ "detail": { "code": "...", "message": "..." } }` with the appropriate HTTP status
**And** no raw Python stack trace or internal error detail is exposed

---

### Story 1.4: NestJS API Scaffold & Core Infrastructure

As a **developer**,
I want the NestJS API scaffolded with config management, structured logging, global exception handling, rate limiting, and the MlSidecarService integration point,
So that the API has a production-ready core ready to accept feature modules with no architectural setup remaining.

**Acceptance Criteria:**

**Given** the api service is running
**When** `GET /api/v1/health` is called
**Then** the response is `{ "status": "ok", "service": "api" }` with HTTP 200

**Given** `api/src/common/ml-sidecar.service.ts`
**When** a developer searches the entire NestJS codebase for the ML sidecar URL
**Then** it appears only in `MlSidecarService` — no other module calls FastAPI directly
**And** the sidecar URL is read from `ML_SIDECAR_URL` via `@nestjs/config`
**And** `@nestjs/axios` is used as the HTTP client

**Given** any unhandled exception
**When** `AllExceptionsFilter` catches it
**Then** the response shape is `{ "statusCode": N, "error": "...", "code": "...", "details": {} }`
**And** no internal stack trace or raw FastAPI error is included in any response

**Given** a client exceeds `THROTTLE_LIMIT` requests within `THROTTLE_TTL` seconds on a protected endpoint
**When** `@nestjs/throttler` triggers
**Then** the response is HTTP 429 with the standard error shape

**Given** any request is processed
**When** the logging interceptor runs
**Then** a structured JSON log entry is emitted with `level`, `message`, `service: "api"`, `timestamp`, request method, and path
**And** no `console.log` calls exist anywhere in the NestJS codebase

**Given** the api service starts with a missing required environment variable
**When** `@nestjs/config` schema validation runs
**Then** the application fails to start immediately with a clear, human-readable error naming the missing variable

---

### Story 1.5: Angular SPA Scaffold & Routing Shell

As a **developer**,
I want the Angular SPA scaffolded with routing, core providers, the HTTP error interceptor, and the application shell,
So that the frontend has a working shell with the correct URL structure and error handling ready for feature development.

**Acceptance Criteria:**

**Given** the frontend service is running
**When** a browser navigates to `http://localhost:4200`
**Then** the Angular application shell loads without console errors
**And** the initial load completes within 2 seconds on a broadband connection (NFR3)

**Given** `frontend/src/app/app.routes.ts`
**When** a developer inspects it
**Then** the following routes are defined with lazy loading: `/` → search feature, `/company/:ticker` → company feature, wildcard `**` → redirects to `/`

**Given** the HTTP error interceptor in `core/interceptors/http-error.interceptor.ts`
**When** any API call returns a 4xx or 5xx response
**Then** the interceptor catches it and routes to an explicit error state
**And** no raw API error message, stack trace, or internal code is shown to the user

**Given** any page renders in the application
**When** the page is inspected
**Then** the disclaimer footer "Not financial advice. Data sourced from public SEC filings." is visible in a semantic `<footer>` element (FR44, UX-DR10, NFR20)

**Given** `frontend/src/environments/`
**When** the files are inspected
**Then** `environment.ts` sets `apiBaseUrl` to `http://localhost:3000/api/v1`
**And** `environment.prod.ts` reads the API URL from a build-time variable — no hardcoded production URLs in source

---

### Story 1.6: GitHub Actions CI/CD Pipeline

As a **developer**,
I want a GitHub Actions pipeline that runs automated quality checks on PRs and build verification on merge to main,
So that code quality and build health are enforced automatically from the first commit.

**Acceptance Criteria:**

**Given** a pull request is opened against `main`
**When** the CI workflow triggers
**Then** it runs lint + type-check + unit tests for the NestJS api
**And** lint + type-check + unit tests for the Angular frontend
**And** `pytest` for the FastAPI ml-sidecar
**And** the workflow fails and blocks merge if any check fails

**Given** a PR is merged to `main`
**When** the CI workflow triggers
**Then** a Docker build check runs for all three services (api, frontend, ml-sidecar)
**And** the workflow fails if any Dockerfile fails to build

**Given** `.github/workflows/ci.yml`
**When** a developer inspects it
**Then** no secrets, API keys, or environment variable values are hardcoded in the file
**And** all secrets are referenced via GitHub Actions repository secrets

---

## Epic 2: UI Design System & Component Specifications

**Layers:** `[DESIGN]`
**Dev split:** Designer — runs in parallel with Epics 3–5; deliverables consumed by Epic 6 (frontend implementation)

The designer produces a complete visual design system and per-component specification for every user-facing element in BullByte: design tokens (colour palette, typography scale, spacing scale), component specs (verdict badge, claim card, timeline, score card, progress feed, claim detail panel, error states, disclaimer footer), responsive layout specs for desktop/tablet/mobile breakpoints, and accessibility specs (contrast ratios, focus indicators, interaction states).

**UX-DRs covered:** UX-DR1, UX-DR2, UX-DR3, UX-DR4, UX-DR5, UX-DR6, UX-DR7, UX-DR8, UX-DR10

---

### Story 2.1: Design Token System

As a **designer**,
I want a complete design token system defined for BullByte,
So that the frontend developer has a single source of truth for all colours, typography, and spacing — ensuring visual consistency across every component.

**Acceptance Criteria:**

**Given** the design token document is delivered
**When** a developer inspects the colour tokens
**Then** the following semantic colour categories are defined with hex values and contrast ratios: brand primary, brand secondary, background, surface, text-primary, text-secondary, text-muted, border, and all five verdict colours (DELIVERED, MISSED, PENDING, INSUFFICIENT_DATA, REVISED)
**And** every verdict colour pair (background + text) meets WCAG AA contrast ratio (≥4.5:1) (NFR22)

**Given** the typography token document
**When** a developer inspects it
**Then** it defines a type scale with at minimum: display (score headline), heading-l (section title), heading-m (card title), body (default text), body-sm (metadata, captions), mono (quote text, filing references)
**And** font family, weight, size (rem), and line-height are specified for each level

**Given** the spacing token document
**When** a developer inspects it
**Then** it defines a spacing scale (e.g. 4px base unit: 4, 8, 12, 16, 24, 32, 48, 64px) that all component specs reference — no ad-hoc pixel values in component specs

**Given** the verdict colour tokens
**When** any verdict status is represented in the UI
**Then** it uses both a colour token AND a text label — never colour alone (NFR22, UX-DR2)

---

### Story 2.2: Core Shared Component Specs

As a **designer**,
I want visual specifications for the shared components used across multiple features,
So that the frontend developer can implement reusable building blocks before tackling feature-specific layouts.

**Acceptance Criteria:**

**Given** the Verdict Badge spec
**When** a developer inspects it
**Then** it defines the visual treatment for all five verdict states: DELIVERED, MISSED, PENDING, INSUFFICIENT_DATA, and REVISED
**And** each state specifies: background colour token, text colour token, text label, and an optional icon
**And** the spec notes that colour + label must always appear together — never colour alone (UX-DR2)

**Given** the Confidence Indicator spec
**When** a developer inspects it
**Then** it defines how confidence scores (0–1) are visually displayed
**And** low-confidence verdicts (below a defined threshold) have a distinct visual treatment (flagged, not suppressed) (FR40, UX-DR5)
**And** the threshold value is specified in the design doc

**Given** the Disclaimer Footer spec
**When** a developer inspects it
**Then** it specifies the footer layout, typography tokens, and the exact disclaimer text: "Not financial advice. Data sourced from public SEC filings."
**And** it appears on every page at the bottom of the viewport (FR44, UX-DR10)

**Given** the Error State spec
**When** a developer inspects it
**Then** it defines explicit visual treatments for: ticker not found, EDGAR filing unavailable, analysis timeout, and low-confidence verdict
**And** each error state includes an icon, heading, body text, and (where applicable) a retry action (UX-DR6, NFR6)

---

### Story 2.3: Search Page & Analysis Progress Feed Specs

As a **designer**,
I want visual specifications for the search page and live analysis progress feed,
So that the developer can implement the primary entry point and the transparency mechanism for fresh ticker analysis.

**Acceptance Criteria:**

**Given** the Search Page spec
**When** a developer inspects it
**Then** it defines the layout, search input field, placeholder text, submit action, and the four loading states: idle, loading, success (redirect to company page), error (ticker not found)
**And** the search input has a visible focus indicator meeting WCAG AA (UX-DR7)

**Given** the Analysis Progress Feed spec
**When** a developer inspects it
**Then** it defines the step message layout, typography, and visual treatment for: in-progress step (active indicator), completed step, and failed step (error indicator) (UX-DR1)
**And** the spec notes that messages update as each agent step completes — no skeleton or placeholder replaces the entire feed (NFR5)
**And** it includes example step messages: "Locating earnings call transcripts...", "Extracted N claims...", "Verifying claim M of N..."

**Given** the spec
**When** a developer inspects the keyboard navigation requirements
**Then** all interactive elements in the search page are reachable and operable via Tab and Enter (UX-DR7, NFR21)

---

### Story 2.4: Promise Timeline & Claim Card Specs

As a **designer**,
I want visual specifications for the promise timeline and individual claim cards,
So that the developer can implement the core browsing interface for a company's promise history.

**Acceptance Criteria:**

**Given** the Promise Timeline spec
**When** a developer inspects it
**Then** it defines the chronological layout spanning up to 8 quarters, the quarter filter/navigation control, and how quarters with no claims are represented
**And** the timeline direction (newest-first or oldest-first) is explicitly specified (FR31, FR33)

**Given** the Claim Card spec
**When** a developer inspects it
**Then** it defines the card layout with: verdict badge, claim metric summary, quarter label, speaker attribution, and confidence indicator
**And** the hover/focus state is specified for keyboard and mouse users (UX-DR7)
**And** the card is distinguishable from adjacent cards with different verdict states by layout and label — not colour alone (NFR22)

**Given** the timeline on desktop (≥1280px)
**When** a developer inspects the layout spec
**Then** the timeline, claim detail panel, and score card are visible simultaneously without scrolling (UX-DR8)

**Given** the timeline on tablet (768px–1279px)
**When** a developer inspects the layout spec
**Then** panels stack vertically and all content remains accessible (UX-DR8)

**Given** the timeline on mobile (≥320px)
**When** a developer inspects the spec
**Then** all content is legible with no horizontal scrolling and text meets minimum size requirements (NFR23, UX-DR8)

---

### Story 2.5: Claim Detail Panel & Reasoning Trace Specs

As a **designer**,
I want visual specifications for the claim detail panel and reasoning trace display,
So that the developer can implement the full transparency view that is BullByte's primary trust mechanism.

**Acceptance Criteria:**

**Given** the Claim Detail Panel spec
**When** a developer inspects it
**Then** it defines the layout for: raw quote (in monospace), speaker attribution, source quarter, verdict badge, quantitative delta display, confidence indicator, direct EDGAR filing link, and share link button (FR36, FR37, FR38, FR41, UX-DR3)

**Given** the Reasoning Trace spec
**When** a developer inspects it
**Then** it defines how the ordered list of tool call steps is displayed: step index, tool name, result summary, and inline EDGAR citation link per step (FR39, UX-DR3)
**And** the trace is expandable — collapsed by default, expanded on user action

**Given** a low-confidence verdict in the claim detail panel
**When** a developer inspects the spec
**Then** the confidence indicator is visually distinct from a high-confidence verdict (flagged, not hidden) (FR40, UX-DR5)
**And** a brief explanatory note ("Low confidence — review reasoning trace") accompanies the flag

**Given** the EDGAR filing link in the panel
**When** a developer inspects the spec
**Then** it is styled as an external link (opens in new tab) with the filing type and quarter visible in the link text (FR38)

---

### Story 2.6: CEO Score Card & Responsive Layout Specs

As a **designer**,
I want visual specifications for the CEO Delivery Score card and the overall company page responsive layout,
So that the developer has a complete layout blueprint before beginning Epic 6 frontend implementation.

**Acceptance Criteria:**

**Given** the CEO Score Card spec
**When** a developer inspects it
**Then** it defines: the score display, sample-size context label, pending claims count, and a visual trend indicator (FR22, FR23, FR24, UX-DR4)
**And** the score is never shown as a raw fraction alone — the sample-size context is always present (FR23)

**Given** the Company Page layout spec at desktop (≥1280px)
**When** a developer inspects it
**Then** the three panels (CEO Score Card, Promise Timeline, Claim Detail) are visible simultaneously with defined column widths and gutters
**And** the spec uses spacing tokens exclusively — no ad-hoc pixel values

**Given** the Company Page layout spec at tablet (768px–1279px)
**When** a developer inspects it
**Then** panels stack in this order: CEO Score Card → Promise Timeline → Claim Detail
**And** the claim detail panel opens inline below the selected claim card

**Given** the Company Page layout spec at mobile (≥320px)
**When** a developer inspects it
**Then** a single-column layout is defined with clear section separation
**And** no element causes horizontal overflow at 320px viewport width (NFR23)

**Given** all component specs in Epic 2
**When** a developer begins Epic 6 implementation
**Then** every component has a named spec covering: states (idle, loading, success, error), typography tokens, colour tokens, spacing tokens, and responsive behaviour

---

## Epic 3: EDGAR Data Ingestion Pipeline

**Layers:** `[ML]` `[DB]`
**Dev split:** Dev 1 — FastAPI EDGAR client, ingestion service, temporal aligner, asyncpg writes

The system can fetch, parse, and persist SEC EDGAR 8-K earnings call transcripts and 10-Q/10-K financial actuals for any given US ticker. Each transcript quarter is temporally aligned to its corresponding actuals quarter with every alignment decision logged. The 10 req/s rate limit is enforced, failed requests are retried with exponential backoff, and all results are cached in PostgreSQL to avoid re-ingestion.

**FRs covered:** FR1, FR2, FR3, FR4, FR5, FR6

---

### Story 3.1: EDGAR HTTP Client with Rate-Limiting Queue

As a **developer**,
I want a throttled EDGAR HTTP client that enforces the 10 req/s rate limit with exponential backoff on failures,
So that the ingestion pipeline never triggers EDGAR's IP block and all fetch attempts are fully logged for auditability.

**Acceptance Criteria:**

**Given** `ml-sidecar/src/core/edgar_client.py` is initialized
**When** multiple concurrent requests are queued
**Then** the client dispatches at most 10 requests per second to EDGAR, regardless of caller concurrency (NFR16)
**And** the queue persists across coroutine boundaries — requests are never silently dropped

**Given** an EDGAR request returns a 429 or 5xx response
**When** the retry handler triggers
**Then** it retries with exponential backoff using `tenacity` — max 3 attempts, up to 30 seconds wait (NFR10)
**And** after exhausting retries it raises a structured `EdgarFetchError` with the ticker, filing type, and final HTTP status

**Given** any EDGAR fetch attempt (success or failure)
**When** the attempt completes
**Then** a structured JSON log entry is emitted with: `ticker`, `filing_type`, `url`, `status`, `attempt_number`, `service: "ml-sidecar"`, `timestamp` (NFR9)
**And** no fetch result is silently discarded — every attempt produces a log entry

**Given** the `EDGAR_USER_AGENT` environment variable is set
**When** any HTTP request is made to EDGAR
**Then** the `User-Agent` header is set to the value of `EDGAR_USER_AGENT`
**And** requests without a valid User-Agent are never sent

---

### Story 3.2: 8-K Earnings Call Transcript Ingestion & Parsing

As a **developer**,
I want the ingestion service to fetch and parse 8-K earnings call transcripts from EDGAR for a given ticker and date range,
So that the extraction pipeline has structured transcript text for every supported quarter.

**Acceptance Criteria:**

**Given** a valid US ticker and date range are provided to `ingestion_service.py`
**When** the service searches EDGAR for 8-K filings
**Then** it retrieves the list of 8-K filing URLs for that ticker within the range
**And** each filing URL is fetched via `edgar_client.py` respecting rate limits (FR1)

**Given** an 8-K filing is fetched
**When** the parser processes it
**Then** it extracts the earnings call transcript text and stores it as: `{ ticker, quarter, filing_date, raw_text, filing_url, parse_status }`
**And** if the filing does not contain a transcript it is skipped with a log entry noting the skip reason

**Given** a filing that cannot be parsed due to unexpected format
**When** the parser encounters the format
**Then** it sets `parse_status: "PARSE_FAILURE"` and logs the failure with the filing URL
**And** it does not raise an exception that halts the entire ingestion run — other filings continue processing

**Given** the 5 demo tickers (TSLA, AAPL, SPOT, META, NVDA) over the last 8 quarters
**When** ingestion runs for each
**Then** at least one 8-K transcript is retrieved and parsed successfully per ticker per available quarter

---

### Story 3.3: 10-Q/10-K Financial Actuals Ingestion & Parsing

As a **developer**,
I want the ingestion service to fetch and parse 10-Q and 10-K financial actuals from EDGAR for a given ticker and quarter,
So that the verification pipeline has the actual reported figures needed to assess each numerical claim.

**Acceptance Criteria:**

**Given** a valid US ticker and quarter (e.g. `"Q3-2024"`) are provided
**When** the service fetches the corresponding 10-Q (or 10-K for Q4) filing
**Then** it retrieves the correct filing via the EDGAR filing index for that ticker and period (FR2)
**And** the fetch goes through `edgar_client.py` with rate limiting enforced

**Given** a 10-Q/10-K filing is fetched
**When** the parser processes it
**Then** it extracts available financial line items: revenue, EPS, operating income, gross margin, net income, and any forward guidance figures
**And** each metric is stored as: `{ ticker, quarter, metric_name, value, unit, section_reference, filing_url, filing_type }`

**Given** a metric that cannot be reliably extracted (ambiguous section or non-standard format)
**When** the parser encounters it
**Then** it marks that metric `parse_status: "AMBIGUOUS"` and logs the ambiguity with filing URL and section reference
**And** no guessed or interpolated values are produced

**Given** a ticker whose 10-Q is not yet filed for the target quarter
**When** the ingestion service requests that quarter
**Then** it returns `status: "FILING_NOT_YET_AVAILABLE"` and logs accordingly without raising an error

---

### Story 3.4: Temporal Alignment Engine

As a **developer**,
I want a temporal alignment engine that maps each earnings call to its correct subsequent reporting quarter's actuals,
So that claims made in one quarter are always verified against the correct actuals filing — never misaligned.

**Acceptance Criteria:**

**Given** an earnings call transcript for a specific quarter
**When** `temporal_aligner.py` maps it to its verification quarter
**Then** it identifies the correct subsequent 10-Q/10-K filing covering the period the claims refer to (FR3)
**And** the mapping decision is logged as a structured record: `{ ticker, call_quarter, actuals_quarter, filing_type, filing_url, alignment_confidence, mapping_rationale }` (FR4, NFR8)

**Given** a mapping where the correct actuals quarter is ambiguous (e.g. fiscal vs calendar year mismatch)
**When** the aligner cannot determine the mapping with high confidence
**Then** it records `alignment_confidence: "LOW"` with a human-readable `mapping_rationale` explaining the ambiguity
**And** it does not silently produce a high-confidence mapping — uncertain alignments are explicitly flagged (NFR8)

**Given** a quarter where no subsequent actuals filing exists yet
**When** the aligner processes that quarter
**Then** it marks the claim status as `PENDING` and logs the reason: actuals quarter not yet filed

**Given** the alignment log for any ticker
**When** a developer inspects it
**Then** every quarter-to-filing mapping decision is present as a structured DB record — no silent mappings or gaps (NFR8)

---

### Story 3.5: yfinance Financial Data Supplement

As a **developer**,
I want the ingestion service to supplement EDGAR financial actuals with yfinance data where EDGAR parsing is ambiguous or incomplete,
So that the verification pipeline has the broadest possible set of financial figures within portfolio-scale usage limits.

**Acceptance Criteria:**

**Given** a ticker and quarter where EDGAR parsing returned `AMBIGUOUS` or missing metrics
**When** the ingestion service calls yfinance as a supplement
**Then** it retrieves available financial figures for that ticker and quarter (FR6)
**And** each yfinance-sourced value is tagged `source: "yfinance"` — never presented as EDGAR-sourced

**Given** any yfinance call
**When** the call completes (success or failure)
**Then** a structured log entry is emitted with: `ticker`, `quarter`, `metrics_requested`, `metrics_returned`, `source: "yfinance"`, `timestamp`
**And** yfinance failures do not halt the ingestion run — the metric is marked unavailable

**Given** yfinance is used for a given metric
**When** the verification pipeline reads that metric
**Then** the `source: "yfinance"` tag is preserved through to the verdict's reasoning trace (NFR19)

---

### Story 3.6: PostgreSQL Caching & Re-ingestion Prevention

As a **developer**,
I want the ingestion service to check PostgreSQL before fetching from EDGAR and persist all results after fetching,
So that repeat requests for the same ticker and quarter return cached data instantly without redundant EDGAR calls.

**Acceptance Criteria:**

**Given** a ticker and quarter that have already been ingested
**When** the ingestion service is triggered again for that combination
**Then** it detects the existing record in PostgreSQL and returns cached data without any EDGAR requests (FR5)
**And** a log entry notes `cache_hit: true` with the ticker and quarter

**Given** a ticker and quarter with no cached data
**When** the ingestion service runs
**Then** it fetches from EDGAR, parses results, and persists them to PostgreSQL before returning
**And** a log entry notes `cache_hit: false` with the ticker, quarter, and fetch duration

**Given** a successful ingestion run
**When** results are written to PostgreSQL via asyncpg
**Then** all writes complete atomically — no partial ingestion records are left in the DB on failure

**Given** concurrent ingestion requests for the same ticker and quarter
**When** both requests check the cache simultaneously
**Then** only one EDGAR fetch occurs — the second request reuses the first result (NFR11)
**And** no duplicate records are created in PostgreSQL

---

### Story 3.7: Press Release Transcript Fallback

As a **developer**,
I want the ingestion service to fall back to EX-99.1 press releases when no full earnings call transcript is found in an 8-K filing,
So that Epic 4 claim extraction has real financial-guidance text for every company-quarter instead of zero cached transcripts.

**Acceptance Criteria:**

**Given** an 8-K exhibit that scores 1–2 keyword matches (likely a press release)
**When** `_extract_transcript_text` processes it
**Then** it returns the extracted text with `parse_status: "PRESS_RELEASE"` — distinguishing it from a full transcript hit

**Given** an 8-K exhibit that scores 0 keyword matches
**When** `_extract_transcript_text` processes it
**Then** it returns `(None, "NO_TRANSCRIPT")` — unchanged from current behaviour

**Given** a filing whose best exhibit scores `PRESS_RELEASE`
**When** ingestion completes for that quarter
**Then** the press release text is persisted to the `transcripts` table with `parse_status = "PRESS_RELEASE"`
**And** `press_releases_extracted` in the `IngestionSummary` is incremented, not `transcripts_extracted`

**Given** a filing whose best exhibit scores `SUCCESS`
**When** ingestion completes
**Then** behaviour is unchanged — `SUCCESS` always beats `PRESS_RELEASE`

---

### Story 3.8: Executive Tenure Schema

As a **developer**,
I want an `executives` table in PostgreSQL that records which person held which C-suite role at which company and when,
So that Epic 4's CEO delivery score (story 4.6) can roll up per-quarter verdicts to a named individual rather than just a ticker.

**Acceptance Criteria:**

**Given** the Drizzle schema file `api/src/db/schema.ts`
**When** this story is complete
**Then** it contains an `executives` table with: `id` (UUID PK), `person_name`, `company_id` (FK → companies), `role`, `start_date`, `end_date` (nullable), `created_at`
**And** a composite index on `(company_id, role)` for efficient CEO lookup

**Given** the Drizzle migration is generated and committed
**When** NestJS starts
**Then** the `executives` table is created automatically via `DrizzleModule`

**Given** `ml-sidecar/src/db/queries.py`
**When** this story is complete
**Then** it contains a `get_executive_at_date(ticker, role, date)` helper that returns the person holding that role at that company on the given date, or `None`

---

## Epic 4: Claim Intelligence — Extraction, Verification & CEO Score

**Layers:** `[ML]` `[DB]`
**Dev split:** Dev 1 — FastAPI extraction/verification/scoring services, LLM abstraction layer, asyncpg writes for claims, verdicts, reasoning traces

Given ingested transcript data for a ticker, the system extracts forward-looking numerical claims (raw quote, speaker attribution, metric, timeframe, extraction confidence), verifies each against financial actuals to produce Delivered / Missed / Insufficient Data verdicts with confidence scores, logs every tool call as a structured reasoning trace, and computes a CEO Delivery Score with sample-size context.

**FRs covered:** FR8, FR9, FR10, FR11, FR13, FR14, FR15, FR16, FR17, FR18, FR22, FR23, FR24

---

### Story 4.1: LLM-Based Numerical Claim Extraction Agent

As a **developer**,
I want an LLM-powered extraction agent that reads an earnings call transcript and produces structured numerical claim objects,
So that every forward-looking quantitative commitment is captured with the data needed for verification.

**Acceptance Criteria:**

**Given** a parsed earnings call transcript is passed to `extraction_service.py`
**When** the LLM extraction agent runs via `BaseLLMProvider.complete()`
**Then** it returns a list of structured claim objects each containing: `raw_quote`, `claim_type`, `metric`, `target_value`, `target_unit`, `timeframe`, `speaker`, `quarter` (FR8, FR9)
**And** the LLM is called only through the abstraction layer — no direct `anthropic` or `openai` imports in `extraction_service.py` (NFR17)

**Given** a transcript containing multiple forward-looking numerical statements
**When** the extraction agent processes it
**Then** each distinct numerical claim produces a separate claim object
**And** no claim is silently dropped — failed extractions produce a structured error record with the raw text segment

**Given** a transcript for any of the 5 demo tickers
**When** extraction runs
**Then** the agent produces at least one valid claim object per quarter where claims were made
**And** each claim object is persisted to the `claims` table via asyncpg

**Given** an LLM API call completes (success or failure)
**When** the call returns
**Then** a structured log entry is emitted with: `model`, `tokens_used`, `estimated_cost_usd`, `ticker`, `jobId`, `service: "ml-sidecar"`, `timestamp` (NFR18)

---

### Story 4.2: Safe-Harbour Boilerplate Filter & Extraction Confidence Scoring

As a **developer**,
I want the extraction agent to filter out safe-harbour boilerplate language and assign a per-claim confidence score,
So that only genuine forward-looking commitments enter the verification pipeline, each with a clear signal of how unambiguously they were stated.

**Acceptance Criteria:**

**Given** a transcript containing safe-harbour disclaimer text
**When** the extraction agent processes the transcript
**Then** no claims are extracted from boilerplate disclaimer passages (FR10)
**And** the filtering decision is logged with the skipped text segment and reason: `"safe_harbour_boilerplate"`

**Given** a clearly stated numerical commitment (e.g. "We expect revenue of $380M in Q3")
**When** the extraction agent scores it
**Then** the claim receives a high `extraction_confidence` score (≥ 0.80) (FR11)

**Given** a hedged or vague numerical statement (e.g. "We think revenue could be somewhere around $380M")
**When** the extraction agent scores it
**Then** the claim receives a lower `extraction_confidence` score (< 0.60)
**And** the score and the hedging language are both preserved in the claim object

**Given** any extracted claim
**When** it is persisted to PostgreSQL
**Then** `extraction_confidence` is stored as `NUMERIC` between 0 and 1 — never a percentage or string label

---

### Story 4.3: Claim Verification Agent — Verdict Engine

As a **developer**,
I want an LLM-powered verification agent that fetches the relevant EDGAR actuals and produces a structured verdict for each numerical claim,
So that every resolved claim has a machine-produced, auditable Delivered / Missed / Insufficient Data determination.

**Acceptance Criteria:**

**Given** a claim object and its temporally aligned actuals quarter
**When** `verification_service.py` runs the verification agent
**Then** it fetches the specific EDGAR filing for that actuals quarter via `edgar_client.py` (FR15)
**And** it extracts the specific metric value from that filing needed to assess the claim (FR16)
**And** all EDGAR fetches go through the rate-limiting queue — no direct HTTP calls in the verification service

**Given** the actual reported value is retrieved
**When** the verification agent compares it to the claimed value
**Then** it produces one of: `DELIVERED`, `MISSED`, or `INSUFFICIENT_DATA` (FR13)
**And** the verdict is stored as SCREAMING_SNAKE_CASE in the `verdicts` table — never lowercase or mixed case

**Given** the EDGAR filing is unavailable, times out, or cannot be parsed
**When** the verification agent exhausts its retries
**Then** it produces an `INSUFFICIENT_DATA` verdict — not an exception or crash (NFR6, NFR10)
**And** the log entry includes the filing URL, failure reason, and number of retry attempts

**Given** an LLM API call during verification
**When** the call completes
**Then** a structured log entry is emitted with: `model`, `tokens_used`, `estimated_cost_usd`, `ticker`, `jobId`, `timestamp` (NFR18)
**And** the LLM is called only through `BaseLLMProvider` — never directly (NFR17)

---

### Story 4.4: Quantitative Delta Calculation & Verification Confidence Scoring

As a **developer**,
I want the verification agent to calculate the quantitative delta between a claimed value and the actual reported value and assign a per-verdict confidence score,
So that every resolved claim shows precisely how far off (or on target) the promise was and how certain the verdict is.

**Acceptance Criteria:**

**Given** a claim with a `target_value` and a retrieved actual value in the same unit
**When** the verification agent calculates the delta
**Then** `delta = actual_value - target_value` is computed and stored in `verdicts` as a signed numeric (FR14)
**And** the delta is `NULL` for `INSUFFICIENT_DATA` verdicts — never a computed value based on missing data

**Given** a claim where actual and claimed values are in different units
**When** the verification agent detects the mismatch
**Then** it normalizes to a common unit before computing the delta and records the normalization step in the reasoning trace
**And** if normalization is not possible it produces `INSUFFICIENT_DATA` with a log entry explaining the unit conflict

**Given** a verdict is produced
**When** the confidence score is assigned
**Then** `confidence_score` reflects certainty: high (clear metric match), medium (inferred match), low (ambiguous metric or definition drift suspected) (FR18)
**And** `confidence_score` is stored as `NUMERIC` between 0 and 1 — never a string label

**Given** a low-confidence verdict
**When** it is written to PostgreSQL
**Then** the verdict record is still written — low-confidence verdicts are never suppressed (UX-DR5)
**And** the low-confidence flag is queryable so the API and UI can surface it distinctly (FR40)

---

### Story 4.5: Structured Reasoning Trace Logger

As a **developer**,
I want every verification tool call and decision step logged as an ordered, structured reasoning trace in PostgreSQL,
So that every verdict has a fully auditable, human-readable record of exactly how BullByte reached its conclusion.

**Acceptance Criteria:**

**Given** the verification agent runs for a claim
**When** each tool call completes (EDGAR fetch, metric extraction, delta calculation, LLM reasoning step)
**Then** a record is written to `reasoning_traces` with: `verdict_id`, `step_index`, `tool_call` (jsonb), `result_summary`, `edgar_filing_ref` (where applicable), `created_at` (FR17)
**And** `step_index` is a sequential integer starting at 1 — the full ordered trace is reconstructable from the DB

**Given** an EDGAR filing is referenced in a reasoning step
**When** the trace record is written
**Then** `edgar_filing_ref` contains the filing type, ticker, quarter, and URL in a consistent format sufficient for a user to navigate directly to the source (FR38, FR39)

**Given** a verification run completes (any verdict)
**When** a developer queries `reasoning_traces` for that verdict
**Then** every tool call is present — no silent tool calls, no suppressed steps (FR17)

**Given** the verification agent encounters an error mid-trace
**When** the error is handled
**Then** the error step is written as a structured entry with `tool_call: { "error": "...", "reason": "..." }`
**And** partial traces do not exist in the DB — the trace is always written to a terminal state

---

### Story 4.6: CEO Delivery Score Computation

As a **developer**,
I want a scoring service that aggregates all resolved verdicts for a company into a CEO Delivery Score with sample-size context,
So that users can see a single credible summary of management's track record that honestly reflects how many claims it is based on.

**Acceptance Criteria:**

**Given** a company with at least one resolved verdict in PostgreSQL
**When** `scoring_service.py` computes the CEO Delivery Score
**Then** it counts: `delivered_count`, `missed_count`, `insufficient_data_count`, `pending_count`, and `total_resolved` (FR22)
**And** `total_resolved = delivered_count + missed_count` — excluding `INSUFFICIENT_DATA` and `PENDING`

**Given** the score is computed
**When** the result is returned
**Then** it includes sample-size context fields: `total_resolved`, `pending_count`, `insufficient_data_count` (FR23)
**And** the score is never returned as a bare fraction without sample-size context

**Given** a company where all claims are `PENDING` or `INSUFFICIENT_DATA`
**When** the scoring service runs
**Then** it returns `score: null` with context: "No resolved claims yet" — never a score of 0 or a divide-by-zero error

**Given** verdicts accumulate over time
**When** score history is queried
**Then** historical scores are reconstructable from the append-only `verdicts` table — no separate score history table is needed (NFR7, FR24)

---

## Epic 5: Analysis Orchestration & Backend API

**Layers:** `[API]` `[DB]` `[INFRA]`
**Dev split:** Dev 2 — NestJS JobsModule (BullMQ + Redis), SSE controller, FastAPI webhook receiver, all public REST endpoints, Drizzle reads, MlSidecarService

A client can trigger ticker analysis via `POST /api/v1/companies/:ticker/analyze`, receive a `jobId`, and monitor real-time step-by-step progress via Server-Sent Events (`GET /api/v1/jobs/:jobId/progress`). FastAPI webhooks relay each agent step to the SSE stream within 5 seconds. The NestJS API serves all endpoints required by the frontend. All verdicts are immutably stored with correction flags enforced at the schema level.

**FRs covered:** FR34 (SSE infrastructure), FR45, plus NestJS API endpoints supporting FR28–41

---

### Story 5.1: BullMQ Async Analysis Job Queue

As a **developer**,
I want a BullMQ-backed job queue in NestJS that accepts ticker analysis requests, manages the full async job lifecycle, and triggers the FastAPI ML sidecar,
So that a fresh ticker analysis can run as a background job of up to 3 minutes without blocking the API caller.

**Acceptance Criteria:**

**Given** a client sends `POST /api/v1/companies/:ticker/analyze`
**When** the ticker has no cached data in PostgreSQL
**Then** NestJS enqueues a BullMQ job and returns `{ "jobId": "<uuid>", "status": "QUEUED" }` with HTTP 202
**And** the job is persisted to Redis so it survives an api service restart

**Given** a BullMQ worker picks up the job
**When** it begins processing
**Then** it calls `MlSidecarService` which POSTs to `http://ml-sidecar:8000/analyze/{ticker}`
**And** the `analysis_jobs` table is updated to `status: "RUNNING"` via Drizzle

**Given** a client sends `POST /api/v1/companies/:ticker/analyze` for a ticker with complete cached data
**When** NestJS checks PostgreSQL
**Then** it returns `{ "jobId": null, "status": "COMPLETED", "cached": true }` with HTTP 200 — no new job is enqueued (FR5)

**Given** the ML sidecar returns an error or times out after max retries
**When** the BullMQ worker handles the failure
**Then** the `analysis_jobs` table is updated to `status: "FAILED"` with the error reason
**And** a structured log entry is emitted with `jobId`, `ticker`, `error`, `timestamp`

**Given** the `analysis_jobs.status` is inspected at any point
**When** a developer reads the value
**Then** it is one of `QUEUED`, `RUNNING`, `COMPLETED`, or `FAILED` in SCREAMING_SNAKE_CASE — never any other value

---

### Story 5.2: SSE Progress Stream Endpoint

As a **developer**,
I want a Server-Sent Events endpoint in NestJS that streams real-time agent step progress to the client for a given job,
So that the Angular frontend can display a live step-by-step feed while a fresh ticker is being analysed.

**Acceptance Criteria:**

**Given** a client opens `GET /api/v1/jobs/:jobId/progress` with `Accept: text/event-stream`
**When** the SSE connection is established
**Then** NestJS keeps the connection open and streams events as they arrive (FR34)
**And** the response `Content-Type` is `text/event-stream` with appropriate no-cache headers

**Given** an SSE event is emitted
**When** a client receives it
**Then** the payload matches the canonical shape: `{ "event": "<event-name>", "jobId": "<uuid>", "stepIndex": N, "totalSteps": N, "message": "...", "timestamp": "ISO8601" }`
**And** `event` is one of the canonical SSE event names in kebab-case: `analysis-started`, `transcript-fetched`, `claims-extracted`, `claim-verified`, `analysis-complete`, `analysis-failed`

**Given** the job reaches a terminal state (`COMPLETED` or `FAILED`)
**When** the terminal SSE event is emitted
**Then** NestJS closes the SSE connection cleanly after the event is delivered
**And** no further events are emitted on that stream

**Given** a client connects to a `jobId` that is already `COMPLETED`
**When** the connection is established
**Then** NestJS immediately emits `analysis-complete` and closes the connection — the client is not left waiting (NFR5)

**Given** multiple clients connect to the same `jobId` SSE stream simultaneously
**When** a progress event is emitted
**Then** all connected clients receive the event with no data corruption or missed events (NFR11)

---

### Story 5.3: FastAPI → NestJS Webhook Progress Relay

As a **developer**,
I want FastAPI to call a NestJS internal webhook after each agent step completes and NestJS to relay that event to the active SSE stream,
So that agent progress is surfaced to the frontend within 5 seconds of each step completing without shared memory or Redis pub/sub.

**Acceptance Criteria:**

**Given** the FastAPI ML sidecar completes an agent step
**When** it calls `POST /internal/jobs/:jobId/progress`
**Then** NestJS receives the webhook payload and relays it to the active SSE stream for that `jobId` within 5 seconds (NFR5)
**And** the webhook endpoint is not reachable from outside the Docker network (NFR13, NFR14)

**Given** the webhook payload arrives at NestJS
**When** NestJS relays it to the SSE stream
**Then** the SSE event payload is identical to the webhook payload — no transformation applied
**And** a structured log entry is emitted with `jobId`, `event`, `stepIndex`, `timestamp`

**Given** a webhook call arrives for a `jobId` with no active SSE client
**When** NestJS processes the webhook
**Then** it accepts the payload gracefully — it does not return an error to FastAPI
**And** FastAPI's analysis run continues uninterrupted regardless of whether a client is listening

**Given** the FastAPI sidecar needs the NestJS webhook URL
**When** it reads its configuration
**Then** it reads `NESTJS_WEBHOOK_URL` from the environment — no hardcoded URLs in FastAPI source (NFR12)

---

### Story 5.4: Company & Search API Endpoints

As a **developer**,
I want NestJS API endpoints for ticker lookup and company summary retrieval,
So that the Angular frontend can look up companies and display the top-level data needed to render the research dashboard.

**Acceptance Criteria:**

**Given** a client sends `GET /api/v1/companies/:ticker`
**When** the company exists in PostgreSQL
**Then** the response is `{ "id": "uuid", "ticker": "TSLA", "name": "Tesla Inc.", "lastAnalysedAt": "ISO8601", "jobStatus": "COMPLETED" }` with HTTP 200 (FR28, FR29)
**And** all JSON field names are camelCase

**Given** a client sends `GET /api/v1/companies/:ticker`
**When** the ticker does not exist in PostgreSQL
**Then** the response is `{ "statusCode": 404, "error": "NOT_FOUND", "code": "TICKER_NOT_FOUND", "details": { "ticker": "XYZ" } }` with HTTP 404
**And** no stack trace or internal detail is included

**Given** a client sends `POST /api/v1/companies/:ticker/analyze` for a new ticker
**When** the request is processed
**Then** NestJS creates a `companies` record if one does not exist for that ticker
**And** a new `analysis_jobs` record is created with `status: "QUEUED"` before the response is returned

**Given** a client sends any request to a NestJS endpoint
**When** the request is processed
**Then** no auth token or session is required (FR30)
**And** no user PII is collected, logged, or stored at any layer (NFR15)

---

### Story 5.5: Claims Timeline & Claim Detail API Endpoints

As a **developer**,
I want NestJS API endpoints that serve the full claims timeline and individual claim detail for a ticker,
So that the Angular frontend has all the structured data it needs to render the promise timeline and claim detail views.

**Acceptance Criteria:**

**Given** a client sends `GET /api/v1/companies/:ticker/claims`
**When** claims exist for that ticker
**Then** the response is `{ "data": [...], "meta": { "total": N, "page": 1, "pageSize": 20 } }` with up to 8 quarters of claims (FR31)
**And** each claim object includes: `id`, `quarter`, `rawQuote`, `speaker`, `metric`, `targetValue`, `targetUnit`, `extractionConfidence`, and a nested `verdict` object (or null if pending)
**And** `quarter` values are in `"Q3-2024"` format — never any other representation

**Given** a client sends `GET /api/v1/claims/:claimId`
**When** the claim exists
**Then** the response includes full claim detail: `rawQuote`, `speaker`, `quarter`, `verdict` (with `verdictType`, `delta`, `confidenceScore`, `isCorrection`), `edgarSourceUrl`, and the ordered `reasoningTrace` array (FR36, FR37, FR38, FR39)
**And** the detail is served from PostgreSQL — no additional calls to FastAPI

**Given** a claim with `confidenceScore` below the low-confidence threshold
**When** the claim detail endpoint responds
**Then** the response includes `"lowConfidence": true` as a top-level field (FR40)
**And** the verdict is still returned — never withheld due to low confidence

**Given** the claims endpoint is called for a ticker with no claims yet
**When** the response is returned
**Then** it returns `{ "data": [], "meta": { "total": 0 } }` with HTTP 200 — not a 404

---

### Story 5.6: CEO Score Endpoint & Immutable Verdict Writes

As a **developer**,
I want a NestJS endpoint that serves the computed CEO Delivery Score and enforces immutable verdict writes for any corrections,
So that the frontend can display the score with full context and verdict integrity is guaranteed at the API layer.

**Acceptance Criteria:**

**Given** a client sends `GET /api/v1/companies/:ticker/score`
**When** resolved verdicts exist for that ticker
**Then** the response includes: `score` (numeric 0–1 or null), `deliveredCount`, `missedCount`, `totalResolved`, `pendingCount`, `insufficientDataCount` (FR22, FR23)
**And** `score` is `null` with `"context": "No resolved claims yet"` when no resolved verdicts exist — never 0

**Given** a verdict correction needs to be written to PostgreSQL
**When** the write occurs
**Then** a new `verdicts` record is created with `is_correction: true` and `corrects_verdict_id` pointing to the original
**And** the original verdict record is never modified — its `created_at` and `verdict_type` are immutable (FR45, NFR7)

**Given** two concurrent requests attempt to write verdicts for the same claim
**When** both writes hit PostgreSQL
**Then** no data corruption or duplicate non-correction records are created (NFR11)

**Given** a score request for a ticker with pending claims
**When** the score is returned
**Then** `pendingCount` accurately reflects the number of unresolved claims
**And** pending claims are never counted in `totalResolved` or factored into the `score` value

---

## Epic 6: Research Dashboard — Search, Timeline, Claim Detail & Score

**Layers:** `[FE]` `[API]`
**Dev split:** Dev 2 — Angular SPA (all features); consumes design specs from Epic 2 and API endpoints from Epic 5

Users can search for any ticker and receive a chronological 8-quarter promise timeline with colour-coded and text-labelled verdict statuses, view the CEO Delivery Score with plain-language sample-size context, monitor live step-by-step analysis progress for fresh tickers, drill into any claim for the full detail view (raw quote, speaker attribution, verdict, delta, confidence score, EDGAR source link, full reasoning trace with inline citations), distinguish low-confidence verdicts visually, and share any ticker or claim via stable URLs — all without an account, with a persistent legal disclaimer on every page.

**FRs covered:** FR28, FR29, FR30, FR31, FR32, FR33, FR34 (progress feed UI), FR36, FR37, FR38, FR39, FR40, FR41, FR44

---

### Story 6.1: Ticker Search Component & Company Page Routing

As a **retail investor**,
I want to type a stock ticker into a search box and be taken directly to that company's promise dashboard,
So that I can access BullByte's analysis in seconds without creating an account or learning any navigation.

**Acceptance Criteria:**

**Given** a user navigates to `/`
**When** the search page renders
**Then** a prominent search input is displayed matching the Epic 2 Search Page spec
**And** the page loads within 2 seconds on a broadband connection (NFR3)
**And** the search input receives focus automatically so the user can type immediately

**Given** a user types a valid ticker (e.g. `TSLA`) and submits
**When** the search is triggered
**Then** the frontend calls `POST /api/v1/companies/:ticker/analyze` then navigates to `/company/TSLA` (FR28, FR29)
**And** the search state transitions through the 4-state loading union: `"idle"` → `"loading"` → `"success"` or `"error"` — never a boolean `isLoading`

**Given** the ticker does not exist in the system
**When** the API returns HTTP 404
**Then** the search renders the ticker-not-found error state matching the Epic 2 Error State spec (UX-DR6)
**And** no raw API error message or code is shown to the user

**Given** a user navigates directly to `/company/TSLA`
**When** the company page loads
**Then** the app fetches `GET /api/v1/companies/TSLA` and renders the company dashboard without requiring a search first (FR29)
**And** the URL is stable and bookmarkable — refreshing renders the same content

**Given** any page in the application
**When** it is rendered
**Then** the disclaimer footer is visible in a semantic `<footer>` element (FR44, NFR20)
**And** the heading hierarchy is correct — one `<h1>` per page with logical subheadings below it

---

### Story 6.2: Analysis Progress Feed Component (SSE)

As a **retail investor**,
I want to see a live step-by-step feed of what BullByte is doing while it analyses a ticker for the first time,
So that I understand what's happening during the wait and feel confident the system is working rather than broken.

**Acceptance Criteria:**

**Given** a fresh ticker analysis is triggered (job status `QUEUED` or `RUNNING`)
**When** the company page renders
**Then** the `AnalysisProgressComponent` opens an `EventSource` connection to `GET /api/v1/jobs/:jobId/progress` (FR34)
**And** each SSE event appends a new step message to the feed within 5 seconds of the agent step completing (NFR5)

**Given** an SSE event is received
**When** the progress feed updates
**Then** the step message text is displayed matching the Epic 2 Progress Feed spec
**And** completed steps are visually distinguished from the in-progress step (UX-DR1)
**And** the feed never shows a blank or skeleton state between steps

**Given** the `analysis-complete` SSE event is received
**When** the event is processed
**Then** the `EventSource` connection is closed
**And** the component automatically fetches `GET /api/v1/companies/:ticker` and re-renders the timeline, score, and claims without a manual page refresh

**Given** the `analysis-failed` SSE event is received
**When** the event is processed
**Then** the progress feed renders the analysis-failed error state matching the Epic 2 Error State spec (UX-DR6)
**And** a retry action triggers a new `POST /api/v1/companies/:ticker/analyze`

**Given** the user navigates away while an SSE stream is open
**When** the Angular component is destroyed
**Then** the `EventSource` connection is closed cleanly — no memory leaks or dangling connections

---

### Story 6.3: Promise Timeline Component with Verdict Status

As a **retail investor**,
I want to see a chronological 8-quarter promise timeline with colour-coded verdict statuses for any company,
So that I can immediately grasp management's track record across time without reading every claim individually.

**Acceptance Criteria:**

**Given** a company page loads with completed analysis
**When** the `TimelineComponent` renders
**Then** it fetches `GET /api/v1/companies/:ticker/claims` and displays claim cards in chronological order for up to 8 quarters (FR31)
**And** the timeline renders within 30 seconds for a cached ticker (NFR2)

**Given** a claim card is rendered
**When** a user views it
**Then** it displays the verdict badge (colour + text label), claim metric summary, quarter, and speaker attribution (FR32)
**And** verdict status is communicated by both colour and text label — never colour alone (NFR22, UX-DR2)

**Given** a user interacts with the quarter filter
**When** they select a specific quarter
**Then** the timeline scrolls to or highlights claims from that quarter (FR33)
**And** the filter state is reflected in the URL so the view is shareable

**Given** a user focuses a claim card via keyboard and presses Enter
**When** the card is activated
**Then** the claim detail panel opens for that claim
**And** focus management follows WCAG standards — focus moves to the panel and returns to the card on close (NFR21)

**Given** the timeline renders on desktop (≥1280px)
**When** viewed simultaneously with the score card and detail panel
**Then** all three panels are visible without scrolling, matching the Epic 2 layout spec (UX-DR8)

**Given** the timeline renders on mobile (≥320px)
**When** a user scrolls
**Then** all content is readable with no horizontal overflow (NFR23)

---

### Story 6.4: CEO Delivery Score Card Component

As a **retail investor**,
I want to see a CEO Delivery Score card that tells me both the score and exactly how many claims it is based on,
So that I can assess management credibility at a glance while understanding the statistical weight behind the number.

**Acceptance Criteria:**

**Given** a company page loads with at least one resolved verdict
**When** the `ScoreCardComponent` renders
**Then** it fetches `GET /api/v1/companies/:ticker/score` and displays the score, delivered count, total resolved, and pending count (FR22, FR23, FR24, UX-DR4)
**And** the score is never shown as a bare fraction — sample-size context is always present (FR23)

**Given** a company with no resolved claims
**When** the score card renders
**Then** it displays "No resolved claims yet" rather than a score of 0 or an error state
**And** the pending claim count is shown so the user knows when to check back

**Given** the score card renders
**When** it is inspected for accessibility
**Then** the score value uses a semantic heading element
**And** the context text is readable by screen readers as a single coherent sentence

**Given** the score card renders on tablet and mobile
**When** the layout adapts
**Then** the score and context text remain legible at all supported breakpoints (UX-DR8, NFR23)

---

### Story 6.5: Claim Detail Panel Component

As a **retail investor**,
I want to click any claim card and see the full detail — the exact quote, verdict, quantitative delta, confidence score, and a direct link to the source EDGAR filing,
So that I can verify BullByte's verdict against the primary source and judge for myself whether I agree.

**Acceptance Criteria:**

**Given** a user clicks or activates a claim card
**When** the `ClaimDetailComponent` opens
**Then** it fetches `GET /api/v1/claims/:claimId` and renders: raw quote (in monospace), speaker attribution, source quarter, verdict badge, quantitative delta, confidence indicator, and EDGAR source link (FR36, FR37, FR38, UX-DR3)
**And** the panel opens instantly with no additional loading spinner beyond the initial card tap (NFR4)

**Given** the claim detail panel renders
**When** a user inspects the EDGAR source link
**Then** it opens in a new tab showing the filing type and quarter in the link text (FR38)

**Given** a verdict with `lowConfidence: true`
**When** the claim detail panel renders
**Then** the confidence indicator is visually distinct from high-confidence verdicts (FR40, UX-DR5)
**And** a brief note explains the low-confidence flag without hiding the verdict

**Given** a user activates the share link button
**When** it is triggered
**Then** the current URL including claim detail state in URL params is copied to the clipboard (FR41)
**And** navigating directly to that URL renders the same claim detail view for any user

**Given** a user closes the claim detail panel via the Escape key
**When** the panel closes
**Then** focus returns to the claim card that opened it (NFR21)

---

### Story 6.6: Reasoning Trace Component with Inline Citations

As a **finance student**,
I want to expand the reasoning trace on any claim and see every tool call BullByte made — including inline citations linking to the exact EDGAR filings it used,
So that I can cite the primary source documents in my research rather than citing BullByte itself.

**Acceptance Criteria:**

**Given** the claim detail panel is open
**When** a user activates the "Show reasoning trace" toggle
**Then** the `ReasoningTraceComponent` expands and renders the ordered list of tool call steps (FR39)
**And** it is collapsed by default — the toggle is the only way to expand it

**Given** the reasoning trace is expanded
**When** a user reads a step that references an EDGAR filing
**Then** the step includes an inline citation link showing the filing type, ticker, and quarter (FR39, UX-DR3)
**And** clicking the link opens the EDGAR filing in a new tab

**Given** the reasoning trace renders
**When** all steps are displayed
**Then** they appear in correct `stepIndex` order with no truncation
**And** each step is visually distinct from adjacent steps

**Given** a claim with verdict `INSUFFICIENT_DATA`
**When** the reasoning trace is expanded
**Then** the final step shows the failure reason as a structured step entry
**And** the trace always ends at the failure point — no steps are missing

---

### Story 6.7: Shareable URLs, Deep Linking & Accessibility Audit

As a **developer**,
I want all ticker and claim views to have stable shareable URLs and the full application to pass a baseline accessibility check,
So that BullByte is demo-ready with every view linkable and meets the accessibility standards defined in the PRD.

**Acceptance Criteria:**

**Given** a user navigates to `/company/TSLA`
**When** the company page loads
**Then** it renders correctly with no 404 or redirect — the URL is stable and shareable (FR29)
**And** refreshing the page renders the same content without requiring a new search

**Given** a user shares a URL with claim detail state in URL params
**When** another user navigates to that URL
**Then** `/company/TSLA` loads and the correct claim detail panel opens automatically (FR41)
**And** the shared URL works without authentication (FR30)

**Given** the complete application
**When** a developer runs a keyboard-navigation test
**Then** every interactive element is reachable via Tab and operable via keyboard alone (NFR21, UX-DR7)
**And** visible focus indicators are present on all focused elements

**Given** the complete application
**When** a developer audits semantic HTML
**Then** every page uses correct landmark regions (`<header>`, `<main>`, `<footer>`), a single `<h1>`, and logical heading hierarchy (NFR20)
**And** all icons have appropriate `aria-label` attributes

**Given** the application renders on a 320px viewport
**When** every page and component is inspected
**Then** no content causes horizontal overflow and all text is legible without pinch-zoom (NFR23)