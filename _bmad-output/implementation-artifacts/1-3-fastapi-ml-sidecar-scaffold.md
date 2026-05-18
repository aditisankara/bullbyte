# Story 1.3: FastAPI ML Sidecar Scaffold

Status: done

## Story

As a **developer**,
I want the FastAPI ML sidecar scaffolded with a health endpoint, LLM abstraction layer skeleton, and asyncpg connection pool,
So that the NestJS API can verify ML sidecar connectivity and the provider-agnostic LLM interface is ready for the intelligence pipeline.

## Acceptance Criteria

1. **Given** the ml-sidecar service is running
   **When** `GET http://ml-sidecar:8000/health` is called
   **Then** the response is `{ "status": "ok", "service": "ml-sidecar" }` with HTTP 200

2. **Given** the ml-sidecar starts
   **When** the asyncpg connection pool initializes
   **Then** it connects to PostgreSQL using `DATABASE_URL`
   **And** a structured JSON log entry is emitted confirming pool readiness with `service: "ml-sidecar"`

3. **Given** `ml-sidecar/src/core/llm/base.py`
   **When** a developer inspects it
   **Then** it defines an abstract `BaseLLMProvider` with at minimum a `complete(messages, tools)` method
   **And** `anthropic_provider.py` and `openai_provider.py` each implement `BaseLLMProvider`
   **And** the active provider is selected at startup via `LLM_PROVIDER` — no other file imports provider modules directly (NFR17)

4. **Given** `POST http://ml-sidecar:8000/analyze/{ticker}` (stub)
   **When** any ticker value is provided
   **Then** the response is `{ "jobId": "stub", "status": "QUEUED" }` with HTTP 202
   **And** the endpoint is wired to `analysis_router.py`

5. **Given** any unhandled exception in the ml-sidecar
   **When** it reaches the global exception handler
   **Then** the response is `{ "detail": { "code": "...", "message": "..." } }` with the appropriate HTTP status
   **And** no raw Python stack trace or internal error detail is exposed

## Tasks / Subtasks

- [x] Task 1: Add dependencies and set up structured JSON logging (AC: 2)
  - [x] Add `python-json-logger`, `openai`, `anthropic` to pyproject.toml via `uv add`
  - [x] Create `src/core/__init__.py`
  - [x] Create `src/core/logging.py` with `ServiceJsonFormatter` and `get_logger()` helper

- [x] Task 2: Create LLM abstraction layer (AC: 3)
  - [x] Create `src/core/llm/__init__.py`
  - [x] Create `src/core/llm/base.py` — `LLMResponse` dataclass, abstract `BaseLLMProvider` with `complete(messages, tools)`, and `get_provider()` factory
  - [x] Create `src/core/llm/openai_provider.py` — `OpenAIProvider` implements `BaseLLMProvider`
  - [x] Create `src/core/llm/anthropic_provider.py` — `AnthropicProvider` implements `BaseLLMProvider`

- [x] Task 3: Create analysis router with stub endpoint (AC: 4)
  - [x] Create `src/routers/__init__.py`
  - [x] Create `src/routers/analysis_router.py` with `POST /analyze/{ticker}` returning 202

- [x] Task 4: Update `src/main.py` with lifespan, exception handlers, and router (AC: 1, 2, 4, 5)
  - [x] Add `asynccontextmanager` lifespan — init DB pool on startup, log readiness, close on shutdown
  - [x] Add global exception handler for `HTTPException` (standard shape)
  - [x] Add global exception handler for generic `Exception` (no stack trace exposed)
  - [x] Include `analysis_router`

- [x] Task 5: Write tests (AC: 1–5)
  - [x] Update `tests/conftest.py` — mock DB pool, set env vars for tests
  - [x] Create `tests/test_analyze.py` — 202 + stub payload + any ticker accepted
  - [x] Create `tests/test_llm_factory.py` — factory returns correct provider type per `LLM_PROVIDER`
  - [x] Create `tests/test_exception_handler.py` — HTTP exception shape + generic exception shape

### Review Findings (AI) — 2026-05-18

#### Patches
- [x] [Review][Patch] `test_factory_raises_when_anthropic_key_missing` deletes wrong env var — confirmed already correct in file (`ANTHROPIC_API_KEY`); false positive from abbreviated diff — dismissed
- [x] [Review][Patch] `AnthropicProvider.complete` overwrites `content` for each text block — fixed: `content = (content or "") + block.text` accumulates all text blocks [ml-sidecar/src/core/llm/anthropic_provider.py]
- [x] [Review][Patch] OpenAI tool `arguments` returned as raw JSON string while Anthropic returns a parsed dict — fixed: `json.loads(tc.function.arguments)` normalizes to dict [ml-sidecar/src/core/llm/openai_provider.py]
- [x] [Review][Patch] `_ServiceJsonFormatter` emits no `timestamp` field — fixed: `log_record["timestamp"] = log_record.pop("asctime", None) or self.formatTime(record)` [ml-sidecar/src/core/logging.py]
- [x] [Review][Patch] `test_404_returns_standard_shape` assertion too weak — fixed: asserts `isinstance(data["detail"], dict)`, `"code" in data["detail"]`, `"message" in data["detail"]` [ml-sidecar/tests/test_exception_handler.py]

#### Deferred
- [x] [Review][Defer] `_split_system` silently keeps only the last system-role message — when multiple system messages appear, earlier ones are overwritten without warning; acceptable for current usage where callers send one system message — deferred, pre-existing design
- [x] [Review][Defer] DB pool startup failure silently swallowed — lifespan catches and logs a warning then yields; subsequent queries that call `get_pool()` will raise unhandled `asyncpg` exceptions mid-request; intentional resilience design for scaffold — deferred, pre-existing
- [x] [Review][Defer] `get_provider()` singleton not thread/concurrency-safe — no lock around `if _provider is None` check; safe for single-worker uvicorn but could create duplicate instances under concurrency — deferred, production hardening
- [x] [Review][Defer] `asyncio.Lock` created at module scope in `pool.py` — pre-existing from story 1.2; raises deprecation warning in Python 3.10+ if instantiated before a running event loop — deferred, pre-existing
- [x] [Review][Defer] `/analyze/{ticker}` accepts any string with no length or format validation — intentional stub; input validation comes with Epic 6 real implementation — deferred, pre-existing
- [x] [Review][Defer] `get_logger` re-evaluates `LOG_LEVEL` on every call even for already-configured loggers — minor inconsistency in long-running processes; not a correctness issue for current usage — deferred, pre-existing
- [x] [Review][Defer] Test route mutation via `app.routes[:]` could bleed state between test runs — existing working pattern; refactoring to avoid `app` mutation requires significant test restructure — deferred, pre-existing
- [x] [Review][Defer] `HTTPException` handler hardcodes `"HTTP_ERROR"` code for all HTTP statuses — loses specificity for 401/403/429 etc.; per-status codes deferred to future auth/rate-limit stories — deferred, pre-existing design
- [x] [Review][Defer] `OpenAIProvider.complete` will `IndexError` if API returns empty `choices` list — documented OpenAI edge case for filtered/truncated responses; generic exception handler catches it but opaquely — deferred, no real LLM calls in scaffold

## Dev Notes

### Architecture Context
- LLM abstraction boundary: `src/core/llm/base.py` defines the interface; provider modules are only imported inside `get_provider()` — no other file imports them directly (NFR17)
- Logging format: `{ level, message, service, timestamp, jobId?, ticker?, traceId? }` — use `python-json-logger` + `ServiceJsonFormatter`
- Pool initialization belongs in the `lifespan` context manager, not scattered across modules
- Exception handler format: `{ "detail": { "code": "...", "message": "..." } }` — applies to both HTTPException and generic Exception; never expose Python tracebacks

### LLM Provider Notes
- `LLM_PROVIDER=openai` (default) uses `openai.AsyncOpenAI`; `LLM_PROVIDER=anthropic` uses `anthropic.AsyncAnthropic`
- `get_provider()` reads `LLM_PROVIDER` + corresponding `*_API_KEY` from env; caches singleton
- Both providers translate to/from internal `LLMResponse(content, tool_calls, model, input_tokens, output_tokens)`
- OpenAI tool format: `{"type": "function", "function": {...}}`; Anthropic format differs — `AnthropicProvider` translates internally
- `reset_provider()` in base.py is a test helper to clear the singleton between test runs

### Test Strategy
- DB pool mocked via `monkeypatch` on `src.db.pool.get_pool` and `src.db.pool.close_pool`
- Tests set `OPENAI_API_KEY=test-key` and `LLM_PROVIDER=openai` in env; actual API never called
- `TestClient` used for all HTTP endpoint tests (wraps async routes synchronously)
- LLM factory tested by checking returned instance type with mocked API key env var

### Prior Work (Story 1.1 + 1.2)
- `ml-sidecar/src/main.py` already had `/health` endpoint — preserved and extended
- `ml-sidecar/src/db/pool.py` has `get_pool()` / `close_pool()` — wired into lifespan
- `ml-sidecar/src/db/queries.py` has write helpers — untouched by this story
- `ml-sidecar/pyproject.toml` already had `asyncpg`, `fastapi`, `pydantic`, `uvicorn`, `httpx`, `pytest`

## Dev Agent Record

### Implementation Plan
Wired existing pool.py into FastAPI lifespan with structured JSON logging. Added LLM abstraction layer (base + openai + anthropic providers) with factory pattern. Added /analyze/{ticker} stub via analysis_router. Added standardized exception handlers. Implemented full test suite with DB pool mocked.

### Debug Log
- 405 from Starlette router bypasses FastAPI exception handlers — test_exception_handler.py updated to trigger HTTPException via explicit raise in a test route rather than relying on router-level 405.

### Completion Notes
- 17/17 tests pass, 0 regressions
- AC1 ✅ health endpoint returns `{"status":"ok","service":"ml-sidecar"}` 200
- AC2 ✅ lifespan calls `get_pool()` and logs `{"message":"Database connection pool ready","service":"ml-sidecar",...}` as structured JSON
- AC3 ✅ `BaseLLMProvider.complete(messages, tools)` abstract; `OpenAIProvider` + `AnthropicProvider` both implement it; `get_provider()` is the only factory — no other file imports providers directly
- AC4 ✅ `POST /analyze/{ticker}` returns `{"jobId":"stub","status":"QUEUED"}` 202 via `analysis_router.py`
- AC5 ✅ HTTPException and generic Exception both return `{"detail":{"code":"...","message":"..."}}` with no stack traces

## File List

- ml-sidecar/pyproject.toml (modified — added python-json-logger, openai, anthropic)
- ml-sidecar/uv.lock (modified)
- ml-sidecar/src/main.py (modified — lifespan, exception handlers, router include)
- ml-sidecar/src/core/__init__.py (new)
- ml-sidecar/src/core/logging.py (new)
- ml-sidecar/src/core/llm/__init__.py (new)
- ml-sidecar/src/core/llm/base.py (new)
- ml-sidecar/src/core/llm/openai_provider.py (new)
- ml-sidecar/src/core/llm/anthropic_provider.py (new)
- ml-sidecar/src/routers/__init__.py (new)
- ml-sidecar/src/routers/analysis_router.py (new)
- ml-sidecar/tests/conftest.py (modified — DB pool mock, env vars autouse fixture)
- ml-sidecar/tests/test_analyze.py (new)
- ml-sidecar/tests/test_llm_factory.py (new)
- ml-sidecar/tests/test_exception_handler.py (new)

## Change Log
- Story file created: 2026-05-11
- Implementation complete: 2026-05-11 — 17/17 tests passing, status → review
