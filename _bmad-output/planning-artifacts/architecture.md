---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
lastStep: 8
status: 'complete'
completedAt: '2026-04-26'
inputDocuments: ["_bmad-output/planning-artifacts/prd.md"]
workflowType: 'architecture'
project_name: 'bullbyte'
user_name: 'Aditi'
date: '2026-04-26'
---

# Architecture Decision Document

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Project Context Analysis

### Requirements Overview

**Functional Requirements:**
45 FRs across 9 domains: Data Ingestion & Pipeline (FR1–7), Claim Extraction (FR8–12), Claim Verification (FR13–21), CEO Delivery Score & Analytics (FR22–27), Search & Discovery (FR28–30), Promise Timeline & Navigation (FR31–35), Claim Detail & Transparency (FR36–41), Research & Benchmarking (FR42–43), and Compliance & Legal (FR44–45).

Phase 1 implements 28 of these FRs. Phase 2 adds 13 (qualitative claims, Revised verdict, definition reconciliation, non-US markets, SEO, reasoning trace UI). Phase 3 adds 4 (multi-model benchmarking, leaderboard, export).

**Non-Functional Requirements:**
- Performance: fresh analysis ≤3 min, cached load ≤30s, SPA shell ≤2s, progress feed updates ≤5s per agent step
- Reliability: append-only verdicts, full structured audit log at every layer, exponential backoff on EDGAR failures, concurrent-safe PostgreSQL writes
- Security: API keys via env vars only, DB not internet-exposed, inter-service communication internal to Docker network, zero PII collected or stored
- Integration: EDGAR ≤10 req/s enforced by persistent request queue, LLM provider swappable (NFR17), yfinance limited to portfolio scale, LLM cost per ticker logged and configurable

**Scale & Complexity:**
- Primary domain: Full-stack web application with ML/AI pipeline sidecar
- Complexity level: High — polyglot services, agentic long-running workloads, temporal reasoning, append-only audit data model, real-time event emission
- Estimated architectural components: 6–8 (SPA, API gateway/orchestrator, ML sidecar, EDGAR ingestion worker, PostgreSQL, job/event bus, LLM abstraction layer, optional benchmark store)

### Technical Constraints & Dependencies

- **Stack is fixed by PRD**: Angular SPA, Node.js REST API, Python/FastAPI ML sidecar, PostgreSQL — not negotiable
- **EDGAR rate limit**: hard ceiling of ~10 req/s enforced by a persistent queue in the ingestion layer; must survive service restarts
- **Docker networking**: all inter-service calls are internal; no service other than Node.js API is reachable from the public internet
- **LLM agnosticism**: the verification agent tool-calling interface must be abstracted so that the provider (Anthropic, OpenAI, open-source) can be swapped without changes to the verification logic
- **No authentication / accounts**: dramatically narrows the security surface; no session management, no user data model required in Phase 1
- **Data immutability**: verdicts are append-only records; corrections add a new record with a correction flag — the data model must enforce this at the schema level, not just by convention

### Cross-Cutting Concerns Identified

1. **Temporal alignment engine** — the highest-risk subsystem; must be a first-class module with explicit structured logging at every mapping decision; uncertain alignments produce Insufficient Data verdicts
2. **Confidence scoring pipeline** — produced at extraction (claim clarity) and verification (verdict certainty); must flow end-to-end from ML sidecar through DB schema to UI display without being dropped or flattened
3. **Audit trail / immutability** — not a logging concern but a data model concern; every EDGAR fetch, every tool call, every alignment decision is a structured database record, never a text log
4. **EDGAR rate-limit queue** — must be persistent (survives restart), respect the 10 req/s ceiling, and apply to both on-demand analysis and scheduled bulk ingestion
5. **LLM provider abstraction** — an architectural interface separating agent reasoning logic from provider-specific API formats
6. **Async job lifecycle management** — fresh analysis is a background job of up to 3 minutes; the architecture must manage job state (queued, running, completed, failed) and expose it to the frontend via the API
7. **Real-time progress emission** — agent step completions must reach the frontend within 5 seconds; requires an event/pub-sub channel between the Python runner and Node.js API
8. **LLM cost tracking** — cost per ticker analysis logged at the API layer; configurable thresholds; influences operational decisions across all phases

## Starter Template Evaluation

### Primary Technology Domain

Polyglot multi-service full-stack application — three independent services scaffolded separately and composed via Docker Compose. No cross-service shared code; services communicate over Docker internal networking.

### Repo Structure Decision

**Selected: Simple folder-per-service monorepo**

Rationale: The three services have incompatible language runtimes (TypeScript/Angular, TypeScript/Node, Python). No shared library code crosses service boundaries. Docker Compose serves as the task orchestrator for local development and deployment. The overhead of Nx or Turborepo is not justified for a 2-developer team at this scale.

```
bullbyte/
├── frontend/          ← Angular SPA (Angular CLI)
├── api/               ← Node.js REST API (NestJS)
├── ml-sidecar/        ← Python ML sidecar (FastAPI + uv)
├── docker-compose.yml
└── .env.example
```

### Service 1 — Frontend: Angular CLI

**Initialization Command:**
```bash
ng new frontend --routing --strict --ssr=false --style=scss
```

**Architectural Decisions Provided:**
- **Language & Runtime:** TypeScript in strict mode; Angular 21 standalone components
- **Routing:** Angular Router pre-configured; stable `/company/:ticker` and claim detail URLs (FR29, FR41) ready from day one
- **Styling Solution:** SCSS; component-scoped styles by default
- **Build Tooling:** esbuild (Angular 17+); fast incremental builds, optimized production bundles
- **Testing Framework:** Jasmine + Karma (unit); Playwright or Cypress for E2E
- **HTTP Layer:** Angular HttpClient + RxJS for all API calls to Node.js layer
- **No SSR:** Client-side rendering only for Phase 1 (SSR considered in Phase 2 alongside SEO work per PRD)
- **Code Organization:** Feature-based folder structure — one folder per major feature (search, timeline, claim-detail, score)

### Service 2 — API: NestJS

**Initialization Command:**
```bash
nest new api --package-manager npm
```

**Architectural Decisions Provided:**
- **Language & Runtime:** TypeScript (strict); Node.js
- **Architecture Pattern:** Module/Controller/Service/Provider dependency injection — maps cleanly to BullByte's domain (TickerModule, ClaimModule, JobModule, ScoreModule)
- **HTTP Framework:** Express (default adapter, swappable to Fastify)
- **Build Tooling:** TypeScript compiler with incremental builds
- **Testing Framework:** Jest pre-configured (unit + e2e scaffolding included)
- **Config Management:** `@nestjs/config` for environment variable management (API keys, DB URLs) — satisfies NFR12
- **Key Optional Modules** (added during implementation):
  - `@nestjs/bull` — persistent job queue for async ticker analysis lifecycle
  - `@nestjs/swagger` — OpenAPI docs for the Angular ↔ API boundary
  - Server-Sent Events (SSE) via NestJS built-in — for real-time progress feed (FR34, NFR5)
  - `pg` / TypeORM or Drizzle — PostgreSQL connection
- **Code Organization:** Feature modules; each domain concept is a self-contained NestJS module

### Service 3 — ML Sidecar: FastAPI + uv

**Initialization Command:**
```bash
uv init ml-sidecar
cd ml-sidecar
uv add fastapi uvicorn pydantic
```

**Note on uv vs pip:** uv is a superset of pip — `uv pip install X` works identically to pip. uv also manages virtualenvs and lock files automatically. No pip knowledge lost; uv replaces pip + venv + pip-tools in one tool.

**Architectural Decisions Provided:**
- **Language & Runtime:** Python 3.12+; async-first via asyncio
- **Framework:** FastAPI 0.136 — async request handling, automatic OpenAPI docs, Pydantic v2 validation built in
- **ASGI Server:** uvicorn (included)
- **Type System:** Pydantic v2 models for all request/response shapes — ensures structured claim, verdict, and reasoning trace objects cross the sidecar boundary consistently
- **Testing Framework:** pytest + httpx (async test client)
- **Dependency Lock:** `uv.lock` — reproducible environments across dev and Docker
- **Code Organization:** Router-per-domain (ingestion, extraction, verification, scoring); shared models package for Pydantic schemas
- **Key dependencies** (added during implementation):
  - `anthropic` / `openai` — behind LLM provider abstraction layer (NFR17)
  - `httpx` — async EDGAR HTTP client with rate-limiting queue
  - `asyncpg` or `SQLAlchemy[asyncio]` — async PostgreSQL writes
  - `tenacity` — exponential backoff for EDGAR retries (NFR10)

**Note:** Project initialization for each service is the first implementation story in each service's epic. Docker Compose wiring (service discovery, env vars, network) is a separate story.

## Core Architectural Decisions

### Decision Priority Analysis

**Critical Decisions (Block Implementation):**
- Drizzle ORM as NestJS data layer; NestJS owns all DB migrations via Drizzle Kit
- Redis required as BullMQ backing store for async job queue
- SSE (Server-Sent Events) as the real-time progress protocol from API to Angular
- FastAPI → NestJS webhook pattern for progress propagation
- Angular Signals for frontend state management

**Important Decisions (Shape Architecture):**
- asyncpg directly in FastAPI ML sidecar (no ORM on the write path)
- REST over internal Docker network for NestJS → FastAPI communication
- URL versioning (`/api/v1/`) for all NestJS endpoints
- Structured JSON error responses across all services
- Railway for Phase 1 demo deployment; GitHub Actions for CI/CD

**Deferred Decisions (Post-MVP):**
- Observability / monitoring stack (Datadog, Grafana) — deferred to Phase 2
- SSR for Angular — deferred to Phase 2 alongside SEO work
- Production-scale financial data provider (replaces yfinance) — before Phase 2 public launch

### Data Architecture

**ORM / Query Layer — NestJS:**
- Decision: **Drizzle ORM** with Drizzle Kit for migrations
- Rationale: TypeScript-native, fully type-safe queries, schema-as-code maps cleanly to the append-only verdict data model; lighter runtime than Prisma; no decorator magic unlike TypeORM
- Schema ownership: NestJS/api owns all table definitions and migration files; ML sidecar writes to these tables via asyncpg without a competing ORM
- Affects: api service, all DB schema files, migration workflow

**DB Access — FastAPI ML Sidecar:**
- Decision: **asyncpg directly** (no ORM)
- Rationale: The sidecar is a structured bulk-writer (claims, verdicts, reasoning traces, tool call logs); Pydantic v2 validates data shapes before write; raw asyncpg gives maximum async throughput with zero ORM overhead
- Affects: ml-sidecar service, all DB write paths in the verification pipeline

**Migrations:**
- Decision: **Drizzle Kit** (NestJS side only)
- Rationale: Single migration authority prevents schema conflicts; Alembic not needed since FastAPI does not own schema definitions
- Affects: api service, CI/CD pipeline (migrations run before app start)

**Caching Strategy:**
- Decision: **PostgreSQL as the cache** (per PRD FR5) — processed claims and verdicts stored and reused on repeat ticker requests
- No Redis data caching; Redis is infrastructure for BullMQ job state only
- Affects: TickerModule cache-check logic in NestJS

**Redis:**
- Decision: **Redis 7** added to Docker Compose as BullMQ backing store
- Rationale: NestJS Bull (`@nestjs/bull` / BullMQ) requires Redis for persistent job queues; this is the only Redis use case in Phase 1
- Affects: docker-compose.yml, NestJS JobModule, environment configuration

### Authentication & Security

- Decision: **No authentication** (fixed by PRD — no accounts, no PII)
- **CORS:** NestJS configured to allow requests from Angular dev origin (`localhost:4200`) and production domain only
- **Rate limiting:** `@nestjs/throttler` on NestJS — 10 analysis requests/minute per IP on the search/analysis endpoint; prevents abuse without auth gating
- **Security headers:** `helmet` middleware on NestJS (XSS, HSTS, content-type sniffing prevention)
- **API keys:** All LLM and external service keys via environment variables only — never in source code (NFR12)
- Affects: NestJS AppModule middleware configuration, docker-compose.yml env_file references

### API & Communication Patterns

**NestJS → FastAPI:**
- Decision: **REST HTTP over internal Docker network**
- Pattern: NestJS POSTs to `http://ml-sidecar:8000/analyze/{ticker}`; FastAPI returns job acknowledgement; progress reported via webhooks
- Rationale: Simple, debuggable, no message broker to operate in Phase 1
- Affects: NestJS AnalysisModule HTTP client, FastAPI router definitions

**Real-Time Progress Feed (FR34, NFR5):**
- Decision: **Server-Sent Events (SSE)**
- Pattern: Angular opens `EventSource` to `GET /api/v1/jobs/{jobId}/progress`; NestJS streams events as each agent step completes; connection closes when job reaches terminal state
- Rationale: One-way server→client stream; simpler than WebSockets for this use case; native browser support; NestJS has built-in SSE support
- Affects: NestJS JobModule SSE controller, Angular AnalysisProgressComponent

**FastAPI → NestJS Progress Routing:**
- Decision: **Webhook per agent step**
- Pattern: FastAPI calls `POST /internal/jobs/{jobId}/progress` on NestJS after each agent step; NestJS relays to the waiting SSE stream for that job
- Rationale: No shared memory or Redis pub/sub needed; each step is a discrete HTTP call, fully logged
- Affects: NestJS internal webhook endpoint, FastAPI agent step completion hooks

**API Versioning:**
- Decision: URL prefix `/api/v1/` on all NestJS routes
- Affects: Angular HttpClient base URL configuration, NestJS global prefix

**Error Handling Standard:**
- NestJS exception filters: `{ error: string, code: string, details?: object }`
- FastAPI: Pydantic validation errors + HTTPException with structured detail
- Angular: global HTTP interceptor routes errors to explicit UI states — no silent failures (NFR6)
- Affects: all three services

### Frontend Architecture

**State Management:**
- Decision: **Angular Signals** (Angular 17+ built-in)
- Rationale: BullByte is a read-heavy research dashboard with three main state slices (search state, ticker/timeline data, active job progress); Signals handle these cleanly without NgRx ceremony
- Affects: all Angular feature components and services

**Component Architecture:**
- Decision: **Standalone components** (Angular 21 default)
- Feature-based folder structure: `search/`, `timeline/`, `claim-detail/`, `score/`, `progress/`
- No NgModule declarations required
- Affects: Angular project structure, routing configuration

**HTTP & Streaming:**
- Angular HttpClient for all REST API calls
- Native browser `EventSource` API for SSE progress stream
- No third-party HTTP library needed
- Affects: Angular services layer

### Infrastructure & Deployment

**Local Development:**
- Docker Compose services: `frontend` (Angular dev server, port 4200), `api` (NestJS, port 3000), `ml-sidecar` (FastAPI/uvicorn, port 8000), `db` (PostgreSQL 16, port 5432), `redis` (Redis 7, port 6379)
- `.env.example` at repo root documents all required environment variables
- Affects: docker-compose.yml, all service Dockerfiles

**Production Hosting (Phase 1 demo):**
- Decision: **Railway**
- Rationale: Deploys Docker Compose directly; PostgreSQL and Redis add-ons available; free tier sufficient for demo; minimal DevOps overhead for a 2-developer team
- Affects: deployment configuration, environment variable management

**CI/CD:**
- Decision: **GitHub Actions**
- Pipeline: lint + type-check + unit tests on PR; build check on merge to main
- Affects: `.github/workflows/` configuration

**Logging:**
- NestJS: **Winston** — structured JSON logs, configurable log levels per environment
- FastAPI: **Python stdlib `logging` + `python-json-logger`** — lightweight structured JSON output
- All logs include service name, job ID (where applicable), and timestamp
- Affects: both backend services, Docker log collection

**Monitoring:**
- Deferred to Phase 2 — Railway's built-in metrics sufficient for Phase 1 demo scale

### Decision Impact Analysis

**Implementation Sequence (order matters):**
1. Docker Compose + environment configuration (all services depend on this)
2. PostgreSQL schema + Drizzle migrations (API and sidecar both depend on this)
3. Redis service (NestJS JobModule depends on this)
4. FastAPI ML sidecar skeleton (NestJS calls this; must exist before integration)
5. NestJS API skeleton with job queue and SSE endpoint
6. Angular SPA skeleton with HttpClient and EventSource wiring
7. EDGAR ingestion pipeline (within ML sidecar)
8. Claim extraction agent (within ML sidecar)
9. Claim verification agent (within ML sidecar)
10. Score computation (within NestJS, reading from PostgreSQL)

**Cross-Component Dependencies:**
- Redis must be running before NestJS JobModule initialises
- Drizzle migrations must run before any service writes to PostgreSQL
- FastAPI webhook URL must be configured in NestJS env before analysis jobs can report progress
- Angular `EventSource` URL depends on NestJS SSE endpoint being live
- LLM provider abstraction layer in FastAPI must be implemented before any verification agent runs

## Implementation Patterns & Consistency Rules

### Pattern Categories Defined

**Critical Conflict Points Identified:** 7 areas where AI agents could diverge and produce incompatible code — naming, structure, API format, data formats, event shapes, state handling, and error propagation.

### Naming Patterns

**Database Naming Conventions (Drizzle schema is the authority):**
- Tables: `snake_case` plural — `companies`, `claims`, `verdicts`, `reasoning_traces`, `tool_call_logs`, `analysis_jobs`
- Columns: `snake_case` — `ticker_symbol`, `confidence_score`, `created_at`, `verdict_type`
- Primary keys: `id` — UUID v4 on all tables
- Foreign keys: `{referenced_table_singular}_id` — `claim_id`, `company_id`
- Timestamps: `created_at` on every table; `updated_at` only where records can be amended (none in Phase 1 — append-only)
- Indexes: `idx_{table}_{column(s)}` — `idx_claims_company_id`
- Drizzle maps `snake_case` columns to `camelCase` TypeScript properties automatically — never manually rename in TypeScript

**API Endpoint Naming (NestJS):**
- Plural nouns, kebab-case: `/api/v1/companies`, `/api/v1/analysis-jobs`, `/api/v1/claims`
- Route parameters: camelCase — `:ticker`, `:jobId`, `:claimId`
- Query parameters: camelCase — `?fromQuarter=Q1-2024&pageSize=20`
- Custom headers: `X-BullByte-{Name}` prefix

**Code Naming Conventions:**

TypeScript (NestJS + Angular):
- Variables and functions: `camelCase`
- Classes, interfaces, types, enums: `PascalCase`
- Constants: `SCREAMING_SNAKE_CASE`
- NestJS modules follow: `{Feature}Module`, `{Feature}Controller`, `{Feature}Service`, `{Feature}Repository`
- Angular components: class `ClaimCardComponent`, selector `app-claim-card`, file `claim-card.component.ts`
- Angular services: class `TickerService`, file `ticker.service.ts`
- Angular signals: no `$` suffix — `readonly tickerData = signal<...>(null)`

Python (FastAPI):
- Variables and functions: `snake_case`
- Classes and Pydantic models: `PascalCase` — `ClaimExtraction`, `VerdictResponse`
- Constants: `SCREAMING_SNAKE_CASE`
- Router files: `snake_case` — `ingestion_router.py`, `verification_router.py`

**Verdict Values — canonical string enum across ALL services and DB:**
`"DELIVERED"` | `"MISSED"` | `"REVISED"` | `"PENDING"` | `"INSUFFICIENT_DATA"`
- SCREAMING_SNAKE_CASE always — never `"delivered"`, `"Delivered"`, or `"missed"`
- Stored as `TEXT` in PostgreSQL; typed as string literal union in TypeScript and `Literal` in Python

**Quarter Format — consistent across ALL services:**
`"Q3-2024"` — string, kebab-separated — never `"2024Q3"`, `"Q3 2024"`, or an object

**Confidence Score Format:**
`number` between `0` and `1` (e.g. `0.87`) — never percentage (`87`), never string (`"high"`)

### Structure Patterns

**NestJS Feature Module Layout:**
```
api/src/
├── common/           <- shared decorators, guards, pipes, interceptors, filters
├── config/           <- @nestjs/config typed configuration
└── {feature}/
    ├── {feature}.module.ts
    ├── {feature}.controller.ts
    ├── {feature}.service.ts
    ├── {feature}.repository.ts   <- Drizzle queries only; no business logic
    ├── dto/                       <- request/response DTOs with class-validator
    └── {feature}.spec.ts          <- co-located unit tests
```

**Angular Feature Layout:**
```
frontend/src/app/
├── core/             <- singleton services (HttpClient wrappers, error handler)
├── shared/           <- shared components, pipes, directives
└── features/
    └── {feature}/
        ├── {feature}.component.ts
        ├── {feature}.component.html
        ├── {feature}.component.scss
        ├── {feature}.service.ts
        ├── {feature}.routes.ts
        └── {feature}.component.spec.ts
```

**FastAPI Layout:**
```
ml-sidecar/src/
├── core/             <- LLM abstraction layer, EDGAR client, rate-limit queue
├── routers/          <- {domain}_router.py per domain
├── services/         <- {domain}_service.py with business logic
├── models/           <- Pydantic request/response models
└── db/               <- asyncpg pool setup, raw SQL helpers
tests/                <- pytest; mirrors src/ structure
```

**Test File Location:**
- NestJS: co-located `*.spec.ts` (NestJS scaffold default)
- Angular: co-located `*.spec.ts`
- FastAPI: `tests/` directory mirroring `src/` structure (Python convention)

### Format Patterns

**API Response Shapes (NestJS):**

Success — single resource:
```json
{ "id": "uuid", "ticker": "TSLA", ... }
```

Success — collection:
```json
{ "data": [...], "meta": { "total": 42, "page": 1, "pageSize": 20 } }
```

Error (all 4xx/5xx):
```json
{ "statusCode": 404, "error": "NOT_FOUND", "code": "TICKER_NOT_FOUND", "details": { "ticker": "XYZ" } }
```

**JSON Field Naming — camelCase throughout the API layer:**
- NestJS to Angular: `camelCase`
- NestJS to/from FastAPI internal calls: `camelCase`
- FastAPI Pydantic models use `model_config = ConfigDict(alias_generator=to_camel)` so Python snake_case fields serialize to camelCase over HTTP
- Database `snake_case` columns are the only place snake_case appears; Drizzle handles the mapping — TypeScript code never sees snake_case field names

**Date and Time Formats:**
- All timestamps: ISO 8601 UTC strings — `"2024-10-15T14:30:00Z"` — never Unix timestamps in API responses
- Date-only fields: `"YYYY-MM-DD"`
- Quarter: `"Q3-2024"` string

**SSE Event Payload (NestJS to Angular):**
```json
{
  "event": "claim-verified",
  "jobId": "uuid",
  "stepIndex": 3,
  "totalSteps": 14,
  "message": "Verified claim 3 of 14: Revenue guidance Q3 2024",
  "timestamp": "2024-10-15T14:30:00Z"
}
```

**Webhook Payload (FastAPI to NestJS progress endpoint):**
```json
{
  "jobId": "uuid",
  "event": "claim-verified",
  "stepIndex": 3,
  "totalSteps": 14,
  "message": "Verified claim 3 of 14: Revenue guidance Q3 2024",
  "timestamp": "2024-10-15T14:30:00Z"
}
```
The shapes are intentionally identical — NestJS relays the payload as-is to SSE.

**SSE Event Names — kebab-case strings:**
`"analysis-started"` | `"transcript-fetched"` | `"claims-extracted"` | `"claim-verified"` | `"analysis-complete"` | `"analysis-failed"`

**Job Status Values:**
`"QUEUED"` | `"RUNNING"` | `"COMPLETED"` | `"FAILED"` — SCREAMING_SNAKE_CASE

### Communication Patterns

**Angular Signal Naming:**
- Signals: noun descriptors, no `$` suffix
  - `readonly tickerData = signal<TickerData | null>(null)`
  - `readonly searchState = signal<"idle" | "loading" | "success" | "error">("idle")`
- Computed signals: verb/adjective descriptors — `readonly hasActiveJob = computed(() => this.jobId() !== null)`
- Effects: named with `effect()` in constructor, not inline lambdas

**Loading State Pattern — 4-state union (never boolean `isLoading`):**
```typescript
"idle" | "loading" | "success" | "error"
```
Applied to every async operation in Angular via Signal. Template switches on this value to render idle placeholder, spinner, data, or error state.

**NestJS to FastAPI HTTP client pattern:**
All calls to the ML sidecar go through a single `MlSidecarService` in NestJS (`src/common/ml-sidecar.service.ts`). No module calls the sidecar directly. This is the single integration point to swap or mock the sidecar.

### Process Patterns

**Error Handling:**

NestJS:
- Global exception filter (`AllExceptionsFilter`) catches everything
- User-facing error messages are human-readable, never expose stack traces or internal service errors
- Internal errors (5xx from FastAPI) are logged in full server-side, returned to Angular as generic `ANALYSIS_FAILED` with a safe message

FastAPI:
- Global exception handler returns structured `{ "detail": { "code": str, "message": str } }` — never raw Python exceptions
- All EDGAR and LLM failures produce `INSUFFICIENT_DATA` verdict, not crashes

Angular:
- Global HTTP interceptor in `CoreModule` catches all 4xx/5xx
- Maps error codes to user-facing strings; no raw API error messages shown
- No unhandled Promise rejections — all async operations use try/catch or observable error operators

Rule: **Error information flows inward (to logs), never outward (to UI).**

**Retry and Backoff:**
- EDGAR retries: FastAPI `tenacity` — exponential backoff, max 3 attempts, 30s max wait; after exhaustion produces `INSUFFICIENT_DATA` verdict
- NestJS to FastAPI HTTP: exponential backoff, max 2 retries on 5xx; no retry on 4xx
- Angular: no automatic retry for user-triggered requests — render error state, provide explicit retry action to user

**Structured Logging — all services emit JSON logs with these fields:**
```json
{
  "level": "info",
  "message": "Claim verification complete",
  "service": "ml-sidecar",
  "timestamp": "2024-10-15T14:30:00Z",
  "jobId": "uuid",
  "ticker": "TSLA",
  "traceId": "uuid"
}
```
- `level`: `debug` | `info` | `warn` | `error`
- `debug` only emitted in development (controlled by `LOG_LEVEL` env var)
- Never log: API keys, LLM prompt content, raw EDGAR response bodies, or any user-identifiable information

### Enforcement Guidelines

**All AI Agents MUST:**
- Use `"Q3-2024"` quarter format — never any other representation
- Use SCREAMING_SNAKE_CASE for verdict and job status values in all layers
- Use camelCase for all JSON field names in API responses (Drizzle and Pydantic handle the DB-to-API translation)
- Never call the FastAPI sidecar from any NestJS module except `MlSidecarService`
- Use the 4-state loading union (`"idle" | "loading" | "success" | "error"`) in all Angular async operations
- Emit structured JSON logs with the required fields — never `console.log` in production code

**Anti-Patterns to Avoid:**
- `isLoading: boolean` in Angular state — use the 4-state union
- `snake_case` field names in NestJS DTOs or Angular interfaces
- Hardcoded LLM provider API calls in verification logic — always go through the LLM abstraction layer in `ml-sidecar/src/core/`
- Verdict values in lowercase or mixed case (`"delivered"`, `"Missed"`)
- Exposing stack traces or internal error messages to Angular responses
- `console.log` in NestJS or FastAPI — use Winston / Python logging
- Silently swallowing errors — every catch block must either re-throw, produce an `INSUFFICIENT_DATA` verdict, or log at `error` level

## Project Structure & Boundaries

### Requirements to Structure Mapping

| FR Category | Service | Location |
|---|---|---|
| FR1–7 Data Ingestion & Pipeline | ml-sidecar | `src/services/ingestion_service.py`, `src/core/edgar_client.py`, `src/core/temporal_aligner.py` |
| FR8–12 Claim Extraction | ml-sidecar | `src/services/extraction_service.py`, `src/core/llm/` |
| FR13–21 Claim Verification | ml-sidecar | `src/services/verification_service.py`, `src/core/llm/` |
| FR22–24 CEO Delivery Score | api + frontend | `api/src/score/`, `frontend/features/company/score-card/` |
| FR28–30 Search & Discovery | api + frontend | `api/src/companies/`, `frontend/features/search/` |
| FR31–35 Promise Timeline | api + frontend | `api/src/claims/`, `frontend/features/timeline/` |
| FR34, NFR5 Progress Feed | api + frontend | `api/src/jobs/` (SSE + webhook), `frontend/features/analysis-progress/` |
| FR36–41 Claim Detail & Transparency | api + frontend | `api/src/claims/` (detail endpoint), `frontend/features/claim-detail/` |
| FR44–45 Compliance & Legal | frontend | `frontend/src/app/shared/components/disclaimer/` |
| FR42–43 Benchmarking | deferred | Phase 3 — not scaffolded in Phase 1 |

### Complete Project Directory Structure

**Root:**
```
bullbyte/
├── .github/
│   └── workflows/
│       └── ci.yml
├── frontend/
├── api/
├── ml-sidecar/
├── docker-compose.yml
├── docker-compose.override.yml
├── .env.example
└── .gitignore
```

**frontend/** (Angular 21):
```
frontend/
├── angular.json
├── package.json
├── tsconfig.json
├── tsconfig.app.json
├── tsconfig.spec.json
├── .eslintrc.json
├── Dockerfile
├── nginx.conf
├── src/
│   ├── main.ts
│   ├── index.html
│   ├── styles.scss
│   ├── environments/
│   │   ├── environment.ts
│   │   └── environment.prod.ts
│   └── app/
│       ├── app.config.ts
│       ├── app.routes.ts
│       ├── app.component.ts
│       ├── app.component.html
│       ├── app.component.scss
│       ├── core/
│       │   ├── services/
│       │   │   ├── api.service.ts
│       │   │   └── error-handler.service.ts
│       │   ├── interceptors/
│       │   │   └── http-error.interceptor.ts
│       │   └── core.providers.ts
│       ├── shared/
│       │   ├── components/
│       │   │   ├── disclaimer/
│       │   │   │   └── disclaimer.component.ts
│       │   │   ├── verdict-badge/
│       │   │   │   └── verdict-badge.component.ts
│       │   │   └── confidence-indicator/
│       │   │       └── confidence-indicator.component.ts
│       │   └── pipes/
│       │       └── quarter-format.pipe.ts
│       └── features/
│           ├── search/
│           │   ├── search.component.ts
│           │   ├── search.component.html
│           │   ├── search.component.scss
│           │   ├── search.service.ts
│           │   ├── search.routes.ts
│           │   └── search.component.spec.ts
│           ├── company/
│           │   ├── company.component.ts
│           │   ├── company.component.html
│           │   ├── score-card/
│           │   │   └── score-card.component.ts
│           │   ├── company.service.ts
│           │   ├── company.routes.ts
│           │   └── company.component.spec.ts
│           ├── timeline/
│           │   ├── timeline.component.ts
│           │   ├── timeline.component.html
│           │   ├── claim-card/
│           │   │   └── claim-card.component.ts
│           │   ├── timeline.service.ts
│           │   ├── timeline.routes.ts
│           │   └── timeline.component.spec.ts
│           ├── claim-detail/
│           │   ├── claim-detail.component.ts
│           │   ├── claim-detail.component.html
│           │   ├── reasoning-trace/
│           │   │   └── reasoning-trace.component.ts
│           │   ├── claim-detail.service.ts
│           │   ├── claim-detail.routes.ts
│           │   └── claim-detail.component.spec.ts
│           └── analysis-progress/
│               ├── analysis-progress.component.ts
│               ├── analysis-progress.component.html
│               ├── progress-feed/
│               │   └── progress-feed.component.ts
│               ├── analysis-progress.service.ts
│               └── analysis-progress.component.spec.ts
```

**api/** (NestJS):
```
api/
├── package.json
├── nest-cli.json
├── tsconfig.json
├── tsconfig.build.json
├── .eslintrc.js
├── Dockerfile
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   ├── config/
│   │   ├── app.config.ts
│   │   └── database.config.ts
│   ├── db/
│   │   ├── schema.ts
│   │   ├── drizzle.module.ts
│   │   └── migrations/
│   ├── common/
│   │   ├── filters/
│   │   │   └── all-exceptions.filter.ts
│   │   ├── interceptors/
│   │   │   └── logging.interceptor.ts
│   │   ├── guards/
│   │   │   └── throttler.guard.ts
│   │   └── ml-sidecar.service.ts
│   ├── companies/
│   │   ├── companies.module.ts
│   │   ├── companies.controller.ts
│   │   ├── companies.service.ts
│   │   ├── companies.repository.ts
│   │   ├── dto/
│   │   │   ├── company-response.dto.ts
│   │   │   └── search-query.dto.ts
│   │   └── companies.spec.ts
│   ├── claims/
│   │   ├── claims.module.ts
│   │   ├── claims.controller.ts
│   │   ├── claims.service.ts
│   │   ├── claims.repository.ts
│   │   ├── dto/
│   │   │   ├── claim-response.dto.ts
│   │   │   └── claim-detail-response.dto.ts
│   │   └── claims.spec.ts
│   ├── score/
│   │   ├── score.module.ts
│   │   ├── score.controller.ts
│   │   ├── score.service.ts
│   │   ├── score.repository.ts
│   │   ├── dto/
│   │   │   └── score-response.dto.ts
│   │   └── score.spec.ts
│   └── jobs/
│       ├── jobs.module.ts
│       ├── jobs.controller.ts
│       ├── jobs.service.ts
│       ├── jobs.repository.ts
│       ├── jobs.processor.ts
│       ├── dto/
│       │   ├── job-response.dto.ts
│       │   └── progress-event.dto.ts
│       └── jobs.spec.ts
└── test/
    └── app.e2e-spec.ts
```

**ml-sidecar/** (FastAPI + uv):
```
ml-sidecar/
├── pyproject.toml
├── uv.lock
├── Dockerfile
├── src/
│   ├── main.py
│   ├── core/
│   │   ├── edgar_client.py
│   │   ├── temporal_aligner.py
│   │   └── llm/
│   │       ├── base.py
│   │       ├── anthropic_provider.py
│   │       └── openai_provider.py
│   ├── routers/
│   │   ├── analysis_router.py
│   │   ├── ingestion_router.py
│   │   └── health_router.py
│   ├── services/
│   │   ├── ingestion_service.py
│   │   ├── extraction_service.py
│   │   ├── verification_service.py
│   │   └── scoring_service.py
│   ├── models/
│   │   ├── claim_models.py
│   │   ├── verdict_models.py
│   │   ├── job_models.py
│   │   └── edgar_models.py
│   └── db/
│       ├── pool.py
│       └── queries.py
└── tests/
    ├── conftest.py
    ├── test_ingestion.py
    ├── test_extraction.py
    ├── test_verification.py
    └── test_temporal_aligner.py
```

### Architectural Boundaries

**Public API Surface (NestJS, port 3000):**
```
POST   /api/v1/companies/:ticker/analyze     <- trigger fresh analysis; returns { jobId }
GET    /api/v1/companies/:ticker             <- company summary + score (cached)
GET    /api/v1/companies/:ticker/claims      <- timeline (up to 8 quarters)
GET    /api/v1/companies/:ticker/score       <- CEO Delivery Score with context
GET    /api/v1/claims/:claimId               <- claim detail with reasoning trace
GET    /api/v1/jobs/:jobId/progress          <- SSE stream (text/event-stream)
```

**Internal Surface (NestJS, not accessible from internet):**
```
POST   /internal/jobs/:jobId/progress        <- webhook receiver from FastAPI
```

**FastAPI Internal Surface (port 8000, Docker internal only):**
```
POST   /analyze/{ticker}
GET    /health
```

**PostgreSQL Schema Boundary:**
- Owned entirely by NestJS (`api/src/db/schema.ts`)
- FastAPI writes via asyncpg using helpers in `db/queries.py`
- No FastAPI code imports from or redefines the schema
- Drizzle migrations run at `api` startup before accepting requests

**LLM Abstraction Boundary:**
- `ml-sidecar/src/core/llm/base.py` defines the provider interface
- `verification_service.py` and `extraction_service.py` import only from `base.py`
- Provider implementations injected via config — no other file imports provider modules directly

### Data Flow

```
User types ticker
       |
       v
Angular SearchComponent
       |  POST /api/v1/companies/:ticker/analyze
       v
NestJS JobsController
       |  check PostgreSQL cache
       |  cache miss -> enqueue BullMQ job -> return { jobId }
       v
Angular opens EventSource -> GET /api/v1/jobs/:jobId/progress (SSE)

NestJS JobsProcessor (BullMQ worker)
       |  POST http://ml-sidecar:8000/analyze/{ticker}
       v
FastAPI analysis_router
       |
   ingestion_service -> EDGAR (throttled, 10 req/s)
   extraction_service -> LLM provider (via abstraction)
   verification_service -> LLM provider (via abstraction)
       |
   After each step: POST /internal/jobs/:jobId/progress (webhook)
       |
       v
NestJS JobsController (webhook receiver)
       |  relay to SSE stream
       v
Angular ProgressFeedComponent

On "analysis-complete" SSE event:
Angular fetches GET /api/v1/companies/:ticker
-> renders timeline, score, claims
```

### Integration Points

**External Integrations:**
- SEC EDGAR public API — rate-limited to 10 req/s by `edgar_client.py`
- LLM provider API (Anthropic or OpenAI) — injected via `core/llm/base.py`
- yfinance — supplementary financial data, Phase 1 only (`ingestion_service.py`)

**Environment Variables (.env.example):**
```
DATABASE_URL=postgresql://...
REDIS_URL=redis://redis:6379
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...
EDGAR_USER_AGENT=BullByte/1.0 contact@example.com
ML_SIDECAR_URL=http://ml-sidecar:8000
NESTJS_WEBHOOK_URL=http://api:3000/internal
LOG_LEVEL=info
THROTTLE_TTL=60
THROTTLE_LIMIT=10
```

## Architecture Validation Results

### Coherence Validation

**Decision Compatibility:** All technology choices are mutually compatible. NestJS 11 + Drizzle ORM (Node 18+), BullMQ + Redis 7, FastAPI 0.136 + asyncpg + PostgreSQL 16, Angular 21 Signals (stable) — no version conflicts.

**Pattern Consistency:** camelCase API layer / snake_case DB boundary is handled by Drizzle column mapping and Pydantic `alias_generator` — TypeScript and Python code never manually translate field names. Verdict enum and quarter format are defined once and referenced everywhere.

**Structure Alignment:** NestJS feature modules map 1:1 to domain boundaries (companies, claims, score, jobs). Angular feature folders map 1:1 to routes. FastAPI routers map 1:1 to pipeline stages. Single integration point (`MlSidecarService`) enforces the NestJS↔FastAPI boundary contract.

**Minor clarification added:** `MlSidecarService` uses `@nestjs/axios` as its HTTP client. `@nestjs/axios` must be added to `api/package.json` dependencies.

### Requirements Coverage Validation

**Phase 1 Functional Requirements (28 FRs):** All covered by architectural decisions and mapped to specific files in the project structure.

**Phase 2–3 Functional Requirements (17 FRs):** All explicitly deferred with rationale. The architecture accommodates them without structural changes — Phase 2 adds new service methods and UI components; Phase 3 adds a new NestJS module for benchmarking.

**Non-Functional Requirements (23 NFRs):** All addressed:
- NFR7 (immutability): append-only schema enforced at Drizzle schema level
- NFR8–9 (audit logging): structured log entries in `temporal_aligner.py` and `edgar_client.py` after every operation
- NFR10 (backoff): `tenacity` in `edgar_client.py`
- NFR11 (concurrency): asyncpg with PostgreSQL transactions for all writes
- NFR17 (LLM swappable): `core/llm/base.py` abstraction
- NFR18 (LLM cost logging): structured log entry in `verification_service.py` after each LLM API call, including model, tokens_used, estimated_cost_usd

### Gap Analysis Results

**Critical Gaps:** None — all Phase 1 requirements have architectural support.

**Minor Clarifications Made During Validation:**
1. `@nestjs/axios` named as the HTTP client for `MlSidecarService`
2. NFR18 LLM cost logging implementation location confirmed: `verification_service.py` emits `{ model, tokens_used, estimated_cost_usd, ticker, jobId }` as a structured `info` log after each LLM call
3. Drizzle Kit migrations run as a Docker Compose startup command in the `api` service — not a separate CI step in Phase 1

**Deferred by Design (not gaps):**
- Accessibility testing tooling (axe-core, Pa11y) — deferred to Phase 2
- Observability stack (Grafana, Datadog) — deferred to Phase 2
- SSR for Angular — deferred to Phase 2 with SEO work
- Production-scale financial data provider — identified before Phase 2 launch

### Architecture Completeness Checklist

**Requirements Analysis**
- [x] Project context thoroughly analyzed (45 FRs, 23 NFRs)
- [x] Scale and complexity assessed (High — polyglot, agentic, append-only)
- [x] Technical constraints identified (EDGAR rate limit, LLM agnosticism, immutability)
- [x] Cross-cutting concerns mapped (8 concerns, all addressed)

**Architectural Decisions**
- [x] Critical decisions documented with rationale
- [x] Technology stack fully specified with versions
- [x] Integration patterns defined (REST, SSE, webhook, BullMQ)
- [x] Performance considerations addressed (caching, async jobs, SSE ≤5s)
- [x] Security decisions made (no auth, env vars, Docker internal network, throttler)

**Implementation Patterns**
- [x] Naming conventions established (DB, API, TypeScript, Python)
- [x] Canonical enums defined (verdict values, job status, SSE event names)
- [x] Structure patterns defined (NestJS modules, Angular features, FastAPI routers)
- [x] Communication patterns specified (camelCase JSON, ISO dates, quarter format)
- [x] Process patterns documented (error handling, retry, logging, loading states)
- [x] Anti-patterns documented (7 explicit prohibitions)

**Project Structure**
- [x] Complete directory structure defined for all 3 services
- [x] Component boundaries established
- [x] Integration points mapped (public API surface, internal surfaces)
- [x] Requirements to structure mapping complete (all FR categories)
- [x] Data flow documented end-to-end

### Architecture Readiness Assessment

**Overall Status: READY FOR IMPLEMENTATION**

**Confidence Level: High** — all decisions are specific, rationale is clear, patterns prevent the most common AI agent conflict points, and the data flow is unambiguous.

**Key Strengths:**
- The `MlSidecarService` single-integration-point pattern prevents sidecar coupling from spreading across the NestJS codebase
- Canonical enum definitions (verdict, job status, SSE events) prevent the most common cross-service consistency failures
- The temporal alignment engine is called out as the highest-risk subsystem with explicit logging requirements
- Append-only data model is enforced at the schema level, not by convention

**Areas for Future Enhancement (Phase 2+):**
- Structured test fixtures for the temporal aligner (critical subsystem deserves a dedicated fixture library)
- Contract testing between NestJS and FastAPI (Pact or similar) to catch webhook payload drift early
- Accessibility audit tooling integrated into CI

### Implementation Handoff

**AI Agent Guidelines:**
- Follow all architectural decisions exactly as documented
- Use implementation patterns consistently — especially the 4-state loading union, canonical enums, and camelCase JSON field names
- Respect the `MlSidecarService` boundary — no NestJS module calls FastAPI directly
- Refer to this document for all architectural questions before making independent decisions

**First Implementation Steps (in order):**
1. `docker-compose.yml` + `.env.example` — all services depend on this
2. Drizzle schema (`api/src/db/schema.ts`) + initial migration — both backends depend on this
3. Service scaffolds: `ng new frontend --routing --strict --ssr=false --style=scss`, `nest new api --package-manager npm`, `uv init ml-sidecar && uv add fastapi uvicorn pydantic`
4. FastAPI skeleton with `/health` and `/analyze/{ticker}` stub
5. NestJS skeleton with job queue, SSE endpoint, and webhook receiver
6. Angular skeleton with routing and SSE EventSource wiring
7. EDGAR ingestion pipeline (highest external dependency risk)
8. Claim extraction agent
9. Claim verification agent
10. Score computation and full end-to-end demo flow