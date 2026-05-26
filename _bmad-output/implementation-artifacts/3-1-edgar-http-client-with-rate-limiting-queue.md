# Story 3.1: EDGAR HTTP Client with Rate-Limiting Queue

Status: done

## Story

As a **developer**,
I want a throttled EDGAR HTTP client that enforces the 10 req/s rate limit with exponential backoff on failures,
So that the ingestion pipeline never triggers EDGAR's IP block and all fetch attempts are fully logged for auditability.

## Acceptance Criteria

1. **Given** `ml-sidecar/src/core/edgar_client.py` is initialized
   **When** multiple concurrent requests are queued
   **Then** the client dispatches at most 10 requests per second to EDGAR, regardless of caller concurrency (NFR16)
   **And** the queue persists across coroutine boundaries — requests are never silently dropped

2. **Given** an EDGAR request returns a 429 or 5xx response
   **When** the retry handler triggers
   **Then** it retries with exponential backoff using `tenacity` — max 3 attempts, up to 30 seconds wait (NFR10)
   **And** after exhausting retries it raises a structured `EdgarFetchError` with the ticker, filing type, and final HTTP status

3. **Given** any EDGAR fetch attempt (success or failure)
   **When** the attempt completes
   **Then** a structured JSON log entry is emitted with: `ticker`, `filing_type`, `url`, `status`, `attempt_number`, `service: "ml-sidecar"`, `timestamp` (NFR9)
   **And** no fetch result is silently discarded — every attempt produces a log entry

4. **Given** the `EDGAR_USER_AGENT` environment variable is set
   **When** any HTTP request is made to EDGAR
   **Then** the `User-Agent` header is set to the value of `EDGAR_USER_AGENT`
   **And** requests without a valid User-Agent are never sent

## Tasks / Subtasks

- [x] Task 1: Add dependencies to pyproject.toml (AC: 1, 2)
  - [x] Move `httpx` from `[dependency-groups] dev` to `[project] dependencies` (it is now a runtime dep, not just test)
  - [x] Add `tenacity>=9.0.0` to `[project] dependencies` via `uv add tenacity`
  - [x] Run `uv sync` to update `uv.lock`

- [x] Task 2: Create Pydantic models file `src/core/edgar_models.py` (AC: 2)
  - [x] Define `EdgarFetchError(Exception)` dataclass with fields: `ticker: str`, `filing_type: str`, `url: str`, `final_status: int`
  - [x] Define `EdgarFetchLog` Pydantic model matching the log shape: `ticker`, `filing_type`, `url`, `status`, `attempt_number`, `service`, `timestamp`

- [x] Task 3: Create rate-limiting EDGAR client `src/core/edgar_client.py` (AC: 1, 2, 3, 4)
  - [x] Implement module-level async token-bucket rate limiter capped at 10 tokens/second using `asyncio.Semaphore` + timestamped release scheduling — no third-party rate-limit library needed
  - [x] Implement `EdgarClient` class (or module-level `fetch()` function) using `httpx.AsyncClient`
  - [x] Set `User-Agent` header from `EDGAR_USER_AGENT` env var on every request; raise `ValueError` at init if env var is missing or empty
  - [x] Wrap each HTTP call with `tenacity.retry` — retry on HTTP 429 and 5xx, exponential backoff (`wait_exponential(multiplier=1, min=1, max=30)`), `stop_after_attempt(3)`
  - [x] Emit a structured JSON log entry on every attempt (success or failure) with fields: `ticker`, `filing_type`, `url`, `status`, `attempt_number`, `service: "ml-sidecar"`, `timestamp` — use `get_logger()` from `src.core.logging`
  - [x] After `tenacity` exhausts all retries, catch `tenacity.RetryError` and raise `EdgarFetchError` with the ticker, filing_type, url, and final HTTP status
  - [x] Expose a module-level `get_client()` factory (analogous to `get_provider()` in LLM layer) that returns a singleton `EdgarClient`

- [x] Task 4: Write tests `tests/test_edgar_client.py` (AC: 1–4)
  - [x] Test: rate limiter dispatches ≤10 calls/second under concurrent load (mock httpx, measure call timing with `asyncio.gather`)
  - [x] Test: 429 response triggers retry; after 3 exhausted attempts raises `EdgarFetchError` with correct fields
  - [x] Test: 5xx response triggers retry; success on second attempt returns response body without raising
  - [x] Test: every attempt (including failed retries) emits a structured log entry (capture with `caplog` or mock logger)
  - [x] Test: `EDGAR_USER_AGENT` env var is set as `User-Agent` header on every request
  - [x] Test: missing `EDGAR_USER_AGENT` env var raises `ValueError` at client initialization
  - [x] Test: 2xx response returns successfully on first attempt with no retry

### Review Findings (AI)

- [x] [Review][Decision→Patch] Non-retried 4xx errors (e.g. 404, 403) surface as raw `httpx.HTTPStatusError` — resolved: wrap all non-retried `httpx.HTTPStatusError` in `EdgarFetchError` for a consistent caller contract; added `except httpx.HTTPStatusError` handler in `_do_fetch` and test `test_non_retried_4xx_raises_edgar_fetch_error` [edgar_client.py:_do_fetch]
- [x] [Review][Patch] `httpx.AsyncClient` is never closed; `reset_client()` in tests discards the old client without calling `aclose()`, leaking connection pool resources and generating `ResourceWarning` — fixed: `_reset` fixture made async, calls `await _client._http_client.aclose()` before reset [tests/test_edgar_client.py:_reset fixture]
- [x] [Review][Patch] Whitespace-only `EDGAR_USER_AGENT` (e.g. `"  "`) passes the `if not user_agent` guard and produces an invalid User-Agent header — fixed: guard changed to `if not user_agent.strip()`; added `test_whitespace_only_user_agent_raises_value_error` [edgar_client.py:__init__]
- [x] [Review][Patch] `respx` installed as a dev dependency but never imported or used in the test suite — removed from `pyproject.toml`, `uv sync` run [pyproject.toml]
- [x] [Review][Defer] `_retrying` tenacity wrapper is recreated on every `_do_fetch` call instead of once at class level — minor allocation waste, not a correctness issue [edgar_client.py:_do_fetch] — deferred, pre-existing
- [x] [Review][Defer] `EdgarFetchLog` Pydantic model is defined but never instantiated in the logging path (logging uses raw `extra={}` dict); model definition is required by spec but wiring it to enforce the log schema is a future concern [edgar_models.py] — deferred, pre-existing
- [x] [Review][Defer] No production shutdown hook to call `await client._http_client.aclose()` on FastAPI app teardown — requires touching `src/main.py` which is out of this story's scope [edgar_client.py] — deferred, out of scope

## Dev Notes

### What This Story Builds

A single file `ml-sidecar/src/core/edgar_client.py` and its models `ml-sidecar/src/core/edgar_models.py`. This is the **only** EDGAR story this sprint — do NOT implement ingestion logic (3.2/3.3), temporal alignment (3.4), yfinance (3.5), or caching (3.6). The client exposes a `fetch(url, ticker, filing_type)` interface; callers are built in later stories.

### File Locations (Architecture-Mandated)

```
ml-sidecar/
  src/
    core/
      edgar_client.py      ← NEW (this story)
      edgar_models.py      ← NEW (this story)
      llm/                 ← existing, do NOT modify
      logging.py           ← existing, import get_logger() from here
    db/
      pool.py              ← existing, NOT touched by this story
    routers/
      analysis_router.py   ← existing stub, NOT modified by this story
  tests/
    test_edgar_client.py   ← NEW (this story)
  pyproject.toml           ← MODIFIED (add tenacity, move httpx to main deps)
```

[Source: architecture.md — FastAPI Project Structure: `core/` section; Requirements to Structure Mapping FR1–7]

### Dependency Changes Required

**httpx** is currently in `[dependency-groups] dev` (test-only). It must move to `[project] dependencies` because the EDGAR client uses it at runtime. Add `tenacity` as a new runtime dependency.

```toml
# pyproject.toml — after changes
[project]
dependencies = [
    "anthropic>=0.100.0",
    "asyncpg>=0.30.0",
    "fastapi>=0.136.1",
    "httpx>=0.28.1",       # moved from dev to runtime
    "openai>=2.36.0",
    "pydantic>=2.13.3",
    "python-json-logger>=4.1.0",
    "tenacity>=9.0.0",     # new
    "uvicorn>=0.46.0",
]

[dependency-groups]
dev = [
    "pytest>=9.0.3",       # httpx removed from here
]
```

[Source: ml-sidecar/pyproject.toml current state; architecture.md FastAPI key dependencies section]

### Rate-Limiter Design

The rate limiter must be **module-level** so it is shared across all concurrent callers (coroutines) — a per-call or per-instance limiter would allow each caller to independently hit 10 req/s, exceeding the aggregate limit.

Recommended: asyncio token bucket using `asyncio.Semaphore(10)` with a background task that releases one token every 100ms. This gives a smooth ≤10 req/s ceiling shared across all coroutines.

```python
# Sketch — implement in edgar_client.py
_rate_semaphore = asyncio.Semaphore(10)

async def _rate_limited_fetch(...):
    async with _rate_semaphore:
        asyncio.get_event_loop().call_later(1.0, _rate_semaphore.release)
        # make request
```

Alternative: use `asyncio-throttle` or `aiolimiter` library if you prefer an off-the-shelf solution. Either is acceptable — the architecture does not mandate a specific rate-limiter library (only `httpx` and `tenacity` are specified).

[Source: architecture.md — Cross-Cutting Concerns: "EDGAR rate-limit queue — must be persistent (survives restart), respect 10 req/s ceiling"; NFR16]

**Important:** "Persists across coroutine boundaries" means module-level shared state within a single process — not persistence across Docker restarts (that is a Phase 2 concern). The queue must be at module scope, not inside a class instance or request handler.

### Tenacity Retry Configuration

```python
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception

@retry(
    retry=retry_if_exception(lambda e: isinstance(e, httpx.HTTPStatusError) and e.response.status_code in (429, *range(500, 600))),
    wait=wait_exponential(multiplier=1, min=1, max=30),
    stop=stop_after_attempt(3),
    reraise=False,  # we catch RetryError ourselves and raise EdgarFetchError
)
async def _fetch_with_retry(client, url, ...):
    ...
```

After `RetryError` is caught, raise `EdgarFetchError(ticker=..., filing_type=..., url=..., final_status=...)`.

[Source: architecture.md — "EDGAR retries: FastAPI `tenacity` — exponential backoff, max 3 attempts, 30s max wait; after exhaustion produces `INSUFFICIENT_DATA` verdict"; NFR10]

### Structured Logging Pattern

Follow the exact pattern from `src/main.py` and `src/core/llm/` — use `get_logger()` from `src.core.logging`, pass extra fields via `extra={}`:

```python
from src.core.logging import get_logger
logger = get_logger("ml-sidecar.edgar_client")

logger.info(
    "EDGAR fetch attempt",
    extra={
        "service": "ml-sidecar",
        "ticker": ticker,
        "filing_type": filing_type,
        "url": url,
        "status": response.status_code,
        "attempt_number": attempt_num,
    }
)
```

**Never log:** raw EDGAR response bodies, API keys, or any user-identifiable information.

[Source: architecture.md — Logging Guidelines; story 1.3 dev notes — logging format `{ level, message, service, timestamp, jobId?, ticker?, traceId? }`]

### EDGAR_USER_AGENT Requirement

SEC EDGAR requires a descriptive User-Agent identifying the application and contact email. Missing or empty User-Agent causes EDGAR to reject requests. The env var default from architecture is `BullByte/1.0 contact@example.com`.

```python
import os

EDGAR_USER_AGENT = os.environ.get("EDGAR_USER_AGENT", "")
if not EDGAR_USER_AGENT:
    raise ValueError("EDGAR_USER_AGENT environment variable must be set")
```

[Source: architecture.md — Environment Variables: `EDGAR_USER_AGENT=BullByte/1.0 contact@example.com`]

### EdgarFetchError Design

The error must carry structured fields (not just a message string) so callers in 3.2/3.3 can log them and produce `INSUFFICIENT_DATA` verdicts without string parsing:

```python
class EdgarFetchError(Exception):
    def __init__(self, ticker: str, filing_type: str, url: str, final_status: int):
        self.ticker = ticker
        self.filing_type = filing_type
        self.url = url
        self.final_status = final_status
        super().__init__(f"EDGAR fetch failed for {ticker}/{filing_type} — status {final_status}")
```

[Source: epics.md — Story 3.1 AC2: "raises a structured `EdgarFetchError` with the ticker, filing type, and final HTTP status"]

### Test Strategy

- **DO NOT** make real HTTP calls to EDGAR in tests — mock `httpx.AsyncClient` with `respx` or `unittest.mock.patch`
- The existing test pattern from 1.3 uses `monkeypatch` for env vars and `TestClient` for HTTP endpoints. For unit-testing the EDGAR client (not a FastAPI endpoint), use `pytest-asyncio` + `asyncio.run` or `anyio`
- `pytest-asyncio` may need to be added to dev deps if not already present — check before adding
- Rate-limit test: verify that 20 concurrent `asyncio.gather` calls to the client take ≥2 seconds (because 20 calls at ≤10/s = ≥2s)

### Patterns from Previous Stories (1.3)

- Singleton factory pattern: `get_provider()` in `src/core/llm/base.py` — apply same pattern as `get_client()` in `edgar_client.py` with a `reset_client()` test helper to clear the singleton
- Module-level logger: `logger = get_logger("ml-sidecar.edgar_client")` at module scope
- Tests set env vars via `monkeypatch.setenv()` in fixtures
- All test files live in `ml-sidecar/tests/` flat (no subdirectories)

[Source: _bmad-output/implementation-artifacts/1-3-fastapi-ml-sidecar-scaffold.md — Dev Notes, Test Strategy, File List]

### Does Not Touch

- `src/main.py` — no router added for the EDGAR client (it is a core library, not a route)
- `src/routers/analysis_router.py` — stub remains unchanged
- `src/db/pool.py`, `src/db/queries.py` — DB writes for EDGAR fetch logs happen in 3.2/3.3, not here
- Any LLM provider files

### Project Structure Notes

- `edgar_client.py` and `edgar_models.py` both go into `src/core/` alongside `logging.py` — this is the architecture-mandated location for cross-cutting infrastructure modules
- The `core/` directory already has `__init__.py` from 1.3 — no new `__init__.py` needed there
- Test file `test_edgar_client.py` goes in `tests/` flat, matching existing test file naming convention

### References

- [Source: architecture.md — Cross-Cutting Concerns: EDGAR rate-limit queue]
- [Source: architecture.md — NFR9, NFR10, NFR16]
- [Source: architecture.md — FastAPI Project Structure: `src/core/edgar_client.py`, `src/core/edgar_models.py`]
- [Source: architecture.md — Environment Variables: EDGAR_USER_AGENT]
- [Source: architecture.md — External Integrations: SEC EDGAR public API]
- [Source: epics.md — Story 3.1: full acceptance criteria]
- [Source: _bmad-output/implementation-artifacts/1-3-fastapi-ml-sidecar-scaffold.md — patterns, test strategy, logging]
- [Source: ml-sidecar/pyproject.toml — current deps to update]

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

- Implemented `EdgarFetchError` exception class and `EdgarFetchLog` Pydantic model in `src/core/edgar_models.py`
- Implemented `EdgarClient` with module-level `asyncio.Semaphore(10)` token-bucket rate limiter; each acquired slot is held for 1.0s via `call_later`, enforcing ≤10 req/s aggregate
- `tenacity.retry` wraps each HTTP attempt: retries on 429/5xx, exponential backoff (min=1s, max=30s), max 3 attempts; `RetryError` is caught and re-raised as `EdgarFetchError` with ticker/filing_type/url/final_status
- Every attempt (success and failure) emits a structured JSON log entry via `get_logger()`, with `ticker`, `filing_type`, `url`, `status`, `attempt_number` in the `extra` dict; `service` and `timestamp` are injected by the formatter
- `get_client()` singleton factory matches the `get_provider()` pattern; `reset_client()` test helper recreates both the singleton and the semaphore
- Added `pytest-asyncio>=0.24.0` and `respx>=0.22.0` to dev deps; `asyncio_mode = "auto"` set in `pyproject.toml`
- 10 new tests written and passing; 1 pre-existing test failure (`test_404_returns_standard_shape`) confirmed unrelated to this story

### File List

- ml-sidecar/pyproject.toml
- ml-sidecar/uv.lock
- ml-sidecar/src/core/edgar_models.py
- ml-sidecar/src/core/edgar_client.py
- ml-sidecar/tests/test_edgar_client.py

## Change Log

- 2026-05-18: Story implemented by claude-sonnet-4-6. Added EDGAR HTTP client with rate-limiting queue: `edgar_models.py`, `edgar_client.py`, `test_edgar_client.py`; updated `pyproject.toml` and `uv.lock` with `tenacity`, `pytest-asyncio`, `respx` deps. All 4 ACs satisfied. 10/10 new tests passing.
