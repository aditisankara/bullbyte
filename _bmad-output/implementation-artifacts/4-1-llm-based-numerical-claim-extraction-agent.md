# Story 4.1: LLM-Based Numerical Claim Extraction Agent

Status: ready-for-dev

## Story

As a **developer**,
I want an LLM-powered extraction agent that reads an earnings call transcript and produces structured numerical claim objects,
so that every forward-looking quantitative commitment is captured with the data needed for verification.

## Acceptance Criteria

**AC1 — Structured claim output from transcript**

Given a parsed earnings call transcript is passed to `extraction_service.py`
When the LLM extraction agent runs via `BaseLLMProvider.complete()`
Then it returns a list of structured claim objects each containing: `raw_quote`, `claim_type`, `metric`, `target_value`, `target_unit`, `timeframe`, `speaker`, `quarter` (FR8, FR9)
And the LLM is called only through the abstraction layer — no direct `anthropic` or `openai` imports in `extraction_service.py` (NFR17)

**AC2 — No silent drops**

Given a transcript containing multiple forward-looking numerical statements
When the extraction agent processes it
Then each distinct numerical claim produces a separate claim object
And no claim is silently dropped — failed extractions produce a structured error record with the raw text segment

**AC3 — Claims persisted per quarter**

Given a transcript for any of the 5 demo tickers
When extraction runs
Then the agent produces at least one valid claim object per quarter where claims were made
And each claim object is persisted to the `claims` table via asyncpg

**AC4 — LLM call cost logging**

Given an LLM API call completes (success or failure)
When the call returns
Then a structured log entry is emitted with: `model`, `tokens_used`, `estimated_cost_usd`, `ticker`, `jobId`, `service: "ml-sidecar"`, `timestamp` (NFR18)

## Tasks / Subtasks

- [ ] Task 1: Create Pydantic models in `ml-sidecar/src/models/claim_models.py` (AC: 1, 2)
  - [ ] Define `ClaimType` Literal: `"revenue"`, `"earnings"`, `"margin"`, `"guidance"`, `"growth"`, `"other"`
  - [ ] Define `ExtractedClaim` model: `raw_quote: str`, `claim_type: ClaimType`, `metric: str`, `target_value: str`, `target_unit: str | None`, `timeframe: str`, `speaker: str | None`, `quarter: str`
  - [ ] Define `ExtractionError` model: `raw_segment: str`, `error_reason: str`
  - [ ] Define `ExtractionResult` model: `claims: list[ExtractedClaim]`, `errors: list[ExtractionError]`, `ticker: str`, `quarter: str`
  - [ ] Apply `model_config = ConfigDict(alias_generator=to_camel)` so models serialize to camelCase over HTTP

- [ ] Task 2: Implement `extraction_service.py` in `ml-sidecar/src/services/` (AC: 1, 2, 3, 4)
  - [ ] Import only from `src.core.llm.base` — never import `anthropic` or `openai` directly
  - [ ] Build system prompt instructing the LLM to extract forward-looking numerical claims as JSON
  - [ ] Include in the prompt: claim format schema, definition of "forward-looking", instruction to skip safe-harbour boilerplate (pure extraction — confidence filtering is story 4.2's scope)
  - [ ] Call `get_provider().complete(messages)` with the transcript text as user message
  - [ ] Parse LLM JSON response into `list[ExtractedClaim]`; on parse failure wrap raw segment in `ExtractionError`
  - [ ] Return `ExtractionResult` with populated `claims` and `errors` lists
  - [ ] Emit cost log after every LLM call: `{ model, tokens_used, estimated_cost_usd, ticker, jobId, service: "ml-sidecar", timestamp }` via `get_logger()`
  - [ ] `extraction_service.py` must not import `asyncpg` — DB persistence is a caller responsibility

- [ ] Task 3: Add asyncpg claim persistence helper to `ml-sidecar/src/db/queries.py` (AC: 3)
  - [ ] `insert_claim()` already exists — verify it accepts all required fields from `ExtractedClaim`
  - [ ] Schema check: `claims` table has `raw_quote`, `metric`, `target_value`, `extraction_confidence`, `speaker`, `quarter`, `company_id` — note `claim_type`, `target_unit`, `timeframe` are **not** in the schema; store `claim_type` + `target_unit` + `timeframe` in `target_value` as a structured string or persist them as-is into available columns (see Dev Notes — schema gap)
  - [ ] Add `insert_claim_batch(claims: list[dict]) -> list[str]` for bulk inserts within a single transaction

- [ ] Task 4: Wire extraction into `analysis_router.py` (AC: 3, 4)
  - [ ] Replace the stub `POST /analyze/{ticker}` with a real implementation that:
    - Fetches cached transcripts from DB for the ticker (query `transcripts` table)
    - Calls `extraction_service.extract_claims(transcript_text, ticker, quarter, job_id)` per transcript
    - Persists each `ExtractedClaim` to DB via `insert_claim_batch()`
    - Sends `claims-extracted` progress webhook after each quarter completes
  - [ ] Accept `jobId` in the request body (already needed by progress webhooks — see story 5.3 pattern)
  - [ ] Keep the endpoint non-blocking: use `BackgroundTasks` or run extraction inline (sidecar is synchronous per ticker)

- [ ] Task 5: Write tests in `ml-sidecar/tests/test_extraction.py` (AC: 1, 2, 3, 4)
  - [ ] `test_extraction_returns_structured_claims` — mock `get_provider()`, feed transcript fixture, assert `ExtractedClaim` fields populated
  - [ ] `test_extraction_no_silent_drops` — LLM returns partial JSON for one claim; assert `ExtractionError` emitted for bad segment, valid claims still returned
  - [ ] `test_llm_called_via_abstraction_only` — assert `anthropic` and `openai` not imported in `extraction_service` module
  - [ ] `test_cost_log_emitted_after_llm_call` — capture log output, assert required fields present
  - [ ] `test_insert_claim_batch_persists_all` — mock asyncpg pool, assert batch insert called once per claim

## Dev Notes

### Current State of Key Files

**`ml-sidecar/src/core/llm/base.py`** — Complete. `BaseLLMProvider.complete(messages, tools=None) -> LLMResponse` is the only interface `extraction_service.py` may import. `get_provider()` returns the singleton. `LLMResponse` has: `content: str | None`, `tool_calls: list[dict]`, `model: str`, `input_tokens: int`, `output_tokens: int`.

**`ml-sidecar/src/core/llm/anthropic_provider.py`** — Complete. Default model: `claude-opus-4-5`. Translates OpenAI-format messages to Anthropic format internally. Do NOT change the default model here — it is injected via config.

**`ml-sidecar/src/routers/analysis_router.py`** — Currently a stub returning `{"jobId": "stub", "status": "QUEUED"}`. Task 4 replaces this.

**`ml-sidecar/src/services/ingestion_service.py`** — Complete (stories 3.1–3.7). After story 3.7 hotfix, `_extract_transcript_text` parses HTML once via BeautifulSoup and uses plain text for scoring. Transcripts with `parse_status = "SUCCESS"` or `"PRESS_RELEASE"` are persisted to DB.

**`ml-sidecar/src/db/queries.py`** — Has `insert_claim()` that takes: `company_id`, `quarter`, `raw_quote`, `metric`, `target_value`, `extraction_confidence`, `speaker`. Note: `extraction_confidence` is required in the DB schema — story 4.2 adds confidence scoring. For 4.1, pass a stub value of `Decimal("0.5")` so rows can be inserted without blocking on 4.2.

**`ml-sidecar/src/core/logging.py`** — Complete. Use `get_logger("ml-sidecar.extraction_service")`. Structured JSON formatter automatically adds `service: "ml-sidecar"` and `timestamp`. Pass extra fields via `extra={}` kwarg.

### Schema Gap: Missing Columns in `claims` Table

The current `claims` table (`api/src/db/schema.ts`) does **not** have `claim_type`, `target_unit`, or `timeframe` columns. The architecture specifies FR8/FR9 require these fields on the extracted claim object, but the Drizzle schema was not yet updated.

**Resolution for 4.1:** Do not add a DB migration in this story. Persist what the schema supports (`raw_quote`, `metric`, `target_value`, `speaker`, `quarter`, `extraction_confidence`). Store `claim_type`, `target_unit`, and `timeframe` in-memory on the `ExtractedClaim` Pydantic model so story 4.2/4.3 can use them. Add a `# TODO story 4.x: add claim_type, target_unit, timeframe columns` comment in `queries.py` at the insert site.

**Do not** alter `api/src/db/schema.ts` or run `drizzle-kit generate` in this story — that is a separate schema migration that belongs to a later story after the full Epic 4 DB requirements are finalized.

### LLM Abstraction Rule (NFR17)

The module-level rule: `extraction_service.py` may only import from `src.core.llm.base`. The pattern:

```python
from src.core.llm.base import get_provider, LLMResponse

async def extract_claims(...) -> ExtractionResult:
    provider = get_provider()
    response: LLMResponse = await provider.complete(messages=[...])
```

Never:
```python
import anthropic          # ❌ banned
from openai import ...    # ❌ banned
```

### Cost Logging Pattern (NFR18)

The ingestion service does not emit cost logs (no LLM calls there). This is the first service to need them. Pattern:

```python
logger.info(
    "LLM call completed",
    extra={
        "model": response.model,
        "tokens_used": response.input_tokens + response.output_tokens,
        "estimated_cost_usd": _estimate_cost(response.model, response.input_tokens, response.output_tokens),
        "ticker": ticker,
        "jobId": job_id,
    }
)
```

Add a `_estimate_cost(model, input_tokens, output_tokens) -> float` helper. Use known pricing constants (e.g., claude-opus-4-5: $15/$75 per 1M tokens input/output). This is a best-effort estimate — not billed.

### Progress Webhook Integration

Story 5.3 implemented the `POST /internal/jobs/:jobId/progress` webhook receiver. After extracting claims for a quarter, send a `claims-extracted` progress event. Reuse `src.core.progress_webhook.send_progress_update(job_id, event, payload)` — check that module for the exact signature.

```python
from src.core.progress_webhook import send_progress_update

await send_progress_update(
    job_id=job_id,
    event="claims-extracted",
    payload={"ticker": ticker, "quarter": quarter, "claimsFound": len(result.claims)},
)
```

### Transcript Fetch from DB

To get transcripts for a ticker, query the `transcripts` table. `queries.py` likely has `get_cached_transcript(ticker, quarter)`. For the analysis router, fetch all quarters: add `get_all_transcripts_for_ticker(ticker) -> list[dict]` to `queries.py` if it doesn't exist. Only process transcripts with `parse_status IN ("SUCCESS", "PRESS_RELEASE")` — skip `"PARSE_FAILURE"`, `"NO_TRANSCRIPT"`, `"FETCH_ERROR"`.

### Extraction Prompt Design

The LLM extraction prompt should:
1. Instruct the model to output a JSON array of claim objects
2. Provide the exact schema for each claim object (field names, types, examples)
3. Define "forward-looking numerical claim": a statement about a *future* metric with a *specific number* (revenue targets, EPS guidance, margin forecasts, unit growth goals)
4. Explicitly exclude: historical reported figures, vague directional statements without numbers, safe-harbour boilerplate disclaimers
5. Ask for `speaker` attribution from the transcript speaker labels (e.g., "Tim Cook - CEO")
6. Ask for `quarter` in `"Q3-2024"` format (the quarter being *predicted*, not the current quarter)

Keep the prompt deterministic — set `temperature=0` if the provider supports it (check `BaseLLMProvider.complete()` signature — currently does not expose temperature; that's a provider-level default, acceptable for now).

### Test Fixture

Use a short realistic transcript excerpt as a test fixture (inline string in `conftest.py` or `test_extraction.py`). Include:
- A clear forward-looking claim: "We expect Q3 revenue to be approximately $120 billion"
- A historical statement that should NOT be extracted: "Q2 revenue was $117 billion"
- A safe-harbour phrase that should NOT be extracted: "These forward-looking statements involve risks and uncertainties"

Mock `get_provider()` using `unittest.mock.patch("src.core.llm.base._provider", mock_provider)`.

### Previous Story Learnings (from 3.7)

- **BeautifulSoup import** is already in requirements (`lxml` parser available)
- **asyncpg pool pattern**: `from src.db.pool import get_pool` → `pool = await get_pool()` — never create your own connection
- **Test isolation**: reset `_provider` singleton between tests using `reset_provider()` from `src.core.llm.base`
- **Concurrent DB writes** need per-key locks if called from async context — extraction is sequential per quarter so this is not an issue in 4.1
- **`insert_transcript()` required `parse_status` as a string literal** — `insert_claim()` similarly requires `extraction_confidence` as `Decimal`, not float
- Code review found that FETCH_ERROR silently overwrote previously found data — in extraction, ensure partial LLM failures do not drop already-parsed claims from earlier chunks

### Architecture Conventions to Follow

- **File location**: `ml-sidecar/src/services/extraction_service.py` (not `core/`)
- **Models location**: `ml-sidecar/src/models/claim_models.py` (not inline in service)
- **Tests location**: `ml-sidecar/tests/test_extraction.py` (mirrors `src/` structure)
- **No ORM in sidecar**: use asyncpg `queries.py` helpers only
- **Pydantic v2 + `ConfigDict(alias_generator=to_camel)`** for camelCase JSON serialization
- **`snake_case`** for all Python identifiers; `camelCase` only in JSON output
- **Quarter format**: always `"Q3-2024"` — never `"2024Q3"`, `"Q3 2024"`, or other variants
- **Verdict / status enums**: `SCREAMING_SNAKE_CASE` (not relevant to this story's output but keep in mind for later)

### Project Structure Notes

- `ml-sidecar/src/models/` currently has: `alignment_models.py`, `financials_models.py`, `ingestion_models.py`, `progress_models.py` — add `claim_models.py` following the same pattern
- `ml-sidecar/src/services/` currently has: `financials_service.py`, `ingestion_service.py`, `yfinance_service.py` — add `extraction_service.py`
- `ml-sidecar/tests/` currently has: `conftest.py`, `test_ingestion.py` (and others) — add `test_extraction.py`

### References

- [Source: ml-sidecar/src/core/llm/base.py] — `BaseLLMProvider`, `LLMResponse`, `get_provider()`, `reset_provider()`
- [Source: ml-sidecar/src/core/llm/anthropic_provider.py] — provider implementation (do not import directly)
- [Source: ml-sidecar/src/core/logging.py] — `get_logger()`, structured JSON log format
- [Source: ml-sidecar/src/core/progress_webhook.py] — `send_progress_update()` signature
- [Source: ml-sidecar/src/db/queries.py] — `insert_claim()` signature and asyncpg pool usage pattern
- [Source: ml-sidecar/src/db/pool.py] — `get_pool()` async pool singleton
- [Source: api/src/db/schema.ts#claims] — authoritative `claims` table columns (schema owner is NestJS)
- [Source: ml-sidecar/src/routers/analysis_router.py] — stub to replace in Task 4
- [Source: ml-sidecar/src/models/ingestion_models.py] — Pydantic model pattern to follow
- [Source: ml-sidecar/src/services/ingestion_service.py] — service pattern, asyncpg usage, logging pattern
- [Source: _bmad-output/implementation-artifacts/3-7-press-release-transcript-fallback.md#Dev Notes] — hotfix notes on BeautifulSoup, test isolation patterns
- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.1] — full acceptance criteria
- [Source: _bmad-output/planning-artifacts/architecture.md#LLM Abstraction Boundary] — NFR17 enforcement
- [Source: _bmad-output/planning-artifacts/architecture.md#Requirements to Structure Mapping] — FR8–12 location mapping

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6 (story creation via bmad-create-story, 2026-05-31)

### Debug Log References

### Completion Notes List

### File List
