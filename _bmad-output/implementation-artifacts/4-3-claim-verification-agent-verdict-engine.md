# Story 4.3: Claim Verification Agent — Verdict Engine

Status: ready-for-dev

## Story

As a **developer**,
I want an LLM-powered verification agent that fetches the relevant EDGAR actuals and produces a structured verdict for each numerical claim,
so that every resolved claim has a machine-produced, auditable DELIVERED / MISSED / INSUFFICIENT_DATA determination.

## Acceptance Criteria

**AC1 — EDGAR actuals fetched via temporal aligner and financials service**

Given a claim object and its `quarter` (the earnings call quarter)
When `verification_service.verify_claim()` runs
Then it calls `align_call_to_actuals(ticker, claim.quarter)` to resolve the actuals quarter
And it calls `ingest_financial_actuals(ticker, actuals_quarter)` to retrieve parsed metrics
And ALL EDGAR HTTP traffic routes through `get_client().fetch()` from `edgar_client.py` — never direct `httpx` calls in the verification service

**AC2 — Verdict produced and stored as SCREAMING_SNAKE_CASE**

Given the actual reported value is retrieved
When the verification agent compares it to the claimed value via LLM
Then it produces one of: `DELIVERED`, `MISSED`, or `INSUFFICIENT_DATA` (FR13)
And `insert_verdict(claim_id=..., verdict_type=<verdict>)` is called with the SCREAMING_SNAKE_CASE string
And the verdict is persisted to the `verdicts` table with `verdict_type` cast to the PostgreSQL `verdict_type` enum via `$3::verdict_type` — never lowercase or mixed case

**AC3 — EDGAR failure produces INSUFFICIENT_DATA, not exception**

Given the EDGAR filing is unavailable, times out, or `FinancialsResult.status` is `"FETCH_ERROR"` or `"FILING_NOT_YET_AVAILABLE"`
When the verification agent exhausts its retries (handled internally by `edgar_client.py` tenacity)
Then `verify_claim()` returns an `INSUFFICIENT_DATA` verdict — never raises an exception to the caller
And the log entry includes `filing_url`, `failure_reason`, and the actuals quarter

**AC4 — LLM called only through BaseLLMProvider**

Given an LLM API call during verification
When `verify_claim()` calls the LLM
Then `get_provider()` from `src.core.llm.base` is the only import for LLM access — no direct `anthropic` or `openai` imports in `verification_service.py` (NFR17)

**AC5 — LLM cost logged after every LLM call**

Given an LLM call completes during verification
When a structured log is emitted
Then it includes: `model`, `tokens_used`, `estimated_cost_usd`, `ticker`, `jobId`, `timestamp` (NFR18)
And uses `logger.info("LLM call completed", extra={...})` — same pattern as `extraction_service.py`

**AC6 — claim-verified SSE event emitted per claim**

Given a verdict is produced for a claim
When the analysis pipeline processes it
Then a `claim-verified` progress event is emitted via `emit_progress()` with the verdict outcome in the message
And `analysis_router.py` captures the `claim_ids` returned by `insert_claim_batch()` and passes them to `verify_claim()` per claim

## Tasks / Subtasks

- [ ] Task 1: Create `ml-sidecar/src/models/verdict_models.py` (AC: 2, 3)
  - [ ] Define `VerdictType = Literal["DELIVERED", "MISSED", "INSUFFICIENT_DATA"]`
  - [ ] Define `VerificationResult(BaseModel)` with fields: `claim_id: str`, `verdict_id: str`, `verdict_type: VerdictType`, `actual_value: str | None`, `actuals_quarter: str`, `mapping_rationale: str`
  - [ ] Apply `model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)` to `VerificationResult`
  - [ ] No `confidence_score` or `delta` fields — those are story 4.4 additions

- [ ] Task 2: Create `ml-sidecar/src/services/verification_service.py` (AC: 1, 2, 3, 4, 5)
  - [ ] Import only from `src.core.llm.base` (never anthropic/openai directly)
  - [ ] Copy `_PRICING` dict from `extraction_service.py` and `_estimate_cost()` helper (or import from shared module — see note below)
  - [ ] Define `_VERIFICATION_SYSTEM_PROMPT` (see Dev Notes for exact prompt text)
  - [ ] Implement `async def verify_claim(claim_id, claim_quarter, claim_metric, target_value, target_unit, ticker, job_id) -> VerificationResult`:
    - [ ] Call `align_call_to_actuals(ticker, claim_quarter)` → `AlignmentDecision`
    - [ ] If `decision.status == "FETCH_ERROR"` or `decision.filing_url == ""` → return INSUFFICIENT_DATA immediately with log
    - [ ] Call `ingest_financial_actuals(ticker, decision.actuals_quarter)` → `FinancialsResult`
    - [ ] If `financials.status in ("FETCH_ERROR", "FILING_NOT_YET_AVAILABLE")` → return INSUFFICIENT_DATA with log
    - [ ] Build LLM messages list: system prompt + user message with claim + formatted actuals
    - [ ] Call `await provider.complete(messages=messages)` — `provider = get_provider()`
    - [ ] Emit LLM cost log (NFR18): `logger.info("LLM call completed", extra={model, tokens_used, estimated_cost_usd, ticker, jobId})`
    - [ ] Parse LLM JSON response: `{"verdict": "DELIVERED"|"MISSED"|"INSUFFICIENT_DATA", "reasoning": "..."}`
    - [ ] On JSON parse failure or invalid verdict → `INSUFFICIENT_DATA` with warning log (never crash)
    - [ ] Call `await insert_verdict(claim_id=claim_id, verdict_type=verdict_type)` → `verdict_id`
    - [ ] Return `VerificationResult(claim_id, verdict_id, verdict_type, actual_value, actuals_quarter, mapping_rationale)`

- [ ] Task 3: Modify `ml-sidecar/src/routers/analysis_router.py` (AC: 6)
  - [ ] Add import: `from src.services.verification_service import verify_claim`
  - [ ] In `_do_extraction()`, capture the return value of `insert_claim_batch()`: `claim_ids = await insert_claim_batch(claim_dicts)`
  - [ ] After emitting `claims-extracted`, add a verification loop:
    ```python
    for claim_id, claim in zip(claim_ids, result.claims):
        verification_result = await verify_claim(
            claim_id=claim_id,
            claim_quarter=claim.quarter,
            claim_metric=claim.metric,
            target_value=claim.target_value,
            target_unit=claim.target_unit,
            ticker=ticker,
            job_id=job_id,
        )
        step += 1
        await emit_progress(ProgressEvent(
            event="claim-verified",
            jobId=job_id,
            stepIndex=step,
            totalSteps=total_steps,
            message=f"Verified {claim.metric} for {ticker} {claim.quarter}: {verification_result.verdict_type}",
            timestamp=datetime.now(timezone.utc).isoformat(),
        ))
    ```
  - [ ] `total_steps` stays as `len(transcripts) + 1`; verification events are emitted with `stepIndex` incrementing beyond `totalSteps` — this is acceptable (frontend clamps progress to 100%)

- [ ] Task 4: Write `ml-sidecar/tests/test_verification.py` (AC: 1, 2, 3, 4, 5, 6)
  - [ ] `test_delivered_verdict` — mock temporal aligner returns ALIGNED + mock financials returns matching metric + mock LLM returns `{"verdict": "DELIVERED", "reasoning": "Revenue matched"}` → assert `result.verdict_type == "DELIVERED"` and `insert_verdict` called with `verdict_type="DELIVERED"`
  - [ ] `test_missed_verdict` — mock LLM returns `{"verdict": "MISSED", "reasoning": "Revenue fell short"}` → assert `result.verdict_type == "MISSED"`
  - [ ] `test_insufficient_data_on_alignment_fetch_error` — mock `align_call_to_actuals` returns `AlignmentDecision(status="FETCH_ERROR")` → assert `result.verdict_type == "INSUFFICIENT_DATA"` without calling financials or LLM
  - [ ] `test_insufficient_data_on_filing_not_yet_available` — mock `ingest_financial_actuals` returns `FinancialsResult(status="FILING_NOT_YET_AVAILABLE")` → `INSUFFICIENT_DATA` without calling LLM
  - [ ] `test_insufficient_data_on_financials_fetch_error` — mock `ingest_financial_actuals` returns `FinancialsResult(status="FETCH_ERROR")` → `INSUFFICIENT_DATA`
  - [ ] `test_insufficient_data_on_llm_parse_failure` — mock LLM returns non-JSON → `INSUFFICIENT_DATA` (no crash)
  - [ ] `test_llm_cost_logged` — mock LLM returns valid verdict; assert `caplog` contains `"LLM call completed"` with `model`, `tokens_used`, `estimated_cost_usd`, `ticker`, `jobId` fields
  - [ ] `test_verdict_stored_screaming_snake_case` — mock `insert_verdict` (patch `src.services.verification_service.insert_verdict`); assert it was called with `verdict_type="DELIVERED"` (all caps)
  - [ ] `test_llm_called_via_abstraction_only` — use `inspect.getsource` or `ast.parse` to assert `verification_service.py` does NOT contain `import anthropic` or `import openai` (same pattern as `test_extraction.py:test_llm_called_via_abstraction_only`)

## Dev Notes

### Architecture: What This Story Builds

Story 4.3 adds a new `verification_service.py` service and extends the existing analysis pipeline in `analysis_router.py`. No new FastAPI router or endpoint is needed — verification runs as part of the same `/analyze/{ticker}` background task.

**Pipeline after 4.3:**
```
POST /analyze/{ticker}
  → _do_extraction()
      → for each transcript: extract_claims() → insert_claim_batch() → [NEW] verify each claim
          → verify_claim(claim_id, ...) → insert_verdict()
          → emit claim-verified SSE event
      → emit analysis-complete
```

### File Locations — Do Not Deviate

| File | Status | Path |
|------|--------|------|
| `verdict_models.py` | NEW | `ml-sidecar/src/models/verdict_models.py` |
| `verification_service.py` | NEW | `ml-sidecar/src/services/verification_service.py` |
| `test_verification.py` | NEW | `ml-sidecar/tests/test_verification.py` |
| `analysis_router.py` | UPDATE | `ml-sidecar/src/routers/analysis_router.py` |
| `queries.py` | NO CHANGE | `ml-sidecar/src/db/queries.py` — `insert_verdict` already exists |
| `main.py` | NO CHANGE | No new router needed |

### Existing Infrastructure to Reuse (Don't Reinvent)

All the building blocks already exist — this story connects them:

1. **`align_call_to_actuals(ticker, call_quarter)` → `AlignmentDecision`**
   - File: `ml-sidecar/src/core/temporal_aligner.py`
   - Never raises — always returns an `AlignmentDecision`. Check `decision.status`:
     - `"ALIGNED"` + `filing_url != ""` → proceed
     - `"FETCH_ERROR"` or `"PENDING"` → produce `INSUFFICIENT_DATA`
   - Import: `from src.core.temporal_aligner import align_call_to_actuals`

2. **`ingest_financial_actuals(ticker, quarter)` → `FinancialsResult`**
   - File: `ml-sidecar/src/services/financials_service.py`
   - Returns `FinancialsResult` with `.status` and `.metrics: list[FinancialMetric]`
   - `FinancialMetricStatus` values: `"SUCCESS"`, `"AMBIGUOUS"`, `"PARSE_FAILURE"`, `"FETCH_ERROR"`
   - `FinancialsResultStatus` values: `"SUCCESS"`, `"PARTIAL"`, `"FILING_NOT_YET_AVAILABLE"`, `"FETCH_ERROR"`
   - On `FETCH_ERROR` or `FILING_NOT_YET_AVAILABLE` → produce `INSUFFICIENT_DATA`
   - Import: `from src.services.financials_service import ingest_financial_actuals`

3. **`insert_verdict(claim_id, verdict_type, ...)` → `str` (verdict UUID)**
   - File: `ml-sidecar/src/db/queries.py` (already implemented)
   - Accepts: `claim_id: str`, `verdict_type: str` (must be in `VALID_VERDICT_TYPES`)
   - `VALID_VERDICT_TYPES = frozenset({"DELIVERED", "MISSED", "INSUFFICIENT_DATA", "PENDING", "REVISED"})`
   - `delta` and `confidence_score` are both `None` for story 4.3 — story 4.4 fills those in
   - Import: `from src.db.queries import insert_verdict`

4. **`get_provider()` → `BaseLLMProvider`**
   - File: `ml-sidecar/src/core/llm/base.py`
   - Import: `from src.core.llm.base import LLMResponse, get_provider`
   - `await provider.complete(messages=messages)` → `LLMResponse`
   - `LLMResponse` fields: `content: str | None`, `tool_calls: list`, `model: str`, `input_tokens: int`, `output_tokens: int`

5. **`emit_progress(event)` → emits webhook**
   - File: `ml-sidecar/src/core/progress_webhook.py`
   - Already imported in `analysis_router.py`
   - Use `event="claim-verified"` for verification events

6. **Rate-limiting EDGAR**: `ingest_financial_actuals` and `align_call_to_actuals` already route through `get_client().fetch()` which enforces ≤10 req/s via `_rate_semaphore`. Do not call `edgar_client.get_client()` directly in `verification_service.py`.

### LLM Pricing Constants

**Copy this pricing dict** from `extraction_service.py` into `verification_service.py` — do NOT import it from `extraction_service` (would create a circular-ish coupling). Keep the two services independent:

```python
_PRICING: dict[str, tuple[float, float]] = {
    "claude-opus-4-5": (15.0, 75.0),
    "claude-opus-4-6": (15.0, 75.0),
    "claude-opus-4-7": (15.0, 75.0),
    "claude-opus-4-8": (15.0, 75.0),
    "claude-sonnet-4-6": (3.0, 15.0),
    "claude-haiku-4-5": (0.25, 1.25),
    "gpt-4o": (5.0, 15.0),
    "gpt-4o-mini": (0.15, 0.60),
    "gpt-4-turbo": (10.0, 30.0),
}

def _estimate_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    input_rate, output_rate = _PRICING.get(model, (10.0, 30.0))
    return (input_tokens * input_rate + output_tokens * output_rate) / 1_000_000
```

### LLM Verification Prompt

Use this exact system prompt in `_VERIFICATION_SYSTEM_PROMPT`:

```python
_VERIFICATION_SYSTEM_PROMPT = """\
You are a financial claim verifier. You are given a forward-looking numerical claim from an earnings call and actual reported financial data from a subsequent SEC filing.

Determine if the claim was DELIVERED, MISSED, or if there is INSUFFICIENT_DATA to make a determination.

Definitions:
- DELIVERED: The actual reported value met or exceeded the claimed target (within 2% relative margin, accounting for unit equivalence)
- MISSED: The actual reported value clearly fell short of or exceeded (for a cost target) the claimed threshold
- INSUFFICIENT_DATA: The filing does not contain a clearly matching metric, the metric definitions differ too much, or the data is ambiguous

Output ONLY a JSON object:
{
  "verdict": "DELIVERED" | "MISSED" | "INSUFFICIENT_DATA",
  "reasoning": "<one sentence explaining the verdict and which metric you matched>",
  "matched_metric": "<metric_name from actuals, or null if INSUFFICIENT_DATA>"
}

Do not output markdown, explanations, or anything outside the JSON object.
"""
```

### LLM User Message Construction

Build the user message as a formatted string — do NOT pass raw dicts:

```python
def _build_verification_prompt(
    claim_metric: str,
    target_value: str,
    target_unit: str | None,
    timeframe: str,
    raw_quote: str,
    actuals_quarter: str,
    filing_type: str,
    metrics: list,  # list[FinancialMetric]
) -> str:
    unit_str = f" {target_unit}" if target_unit else ""
    metrics_lines = "\n".join(
        f"  - {m.metric_name}: {m.value} {m.unit} (source: {m.section_reference}, status: {m.parse_status})"
        for m in metrics
        if m.parse_status in ("SUCCESS", "PARTIAL")  # skip FETCH_ERROR/PARSE_FAILURE
    ) or "  (no metrics available)"
    return (
        f"Claim from earnings call:\n"
        f"  Metric: {claim_metric}\n"
        f"  Claimed value: {target_value}{unit_str}\n"
        f"  Timeframe: {timeframe}\n"
        f"  Original quote: \"{raw_quote}\"\n\n"
        f"Actual reported data from {actuals_quarter} ({filing_type}):\n"
        f"{metrics_lines}"
    )
```

Note: `timeframe` is NOT a field on `ExtractedClaim` in the current DB schema (it wasn't stored). Pass `claim_quarter` as timeframe if `timeframe` is unavailable. When calling from `analysis_router.py`, you have the `ExtractedClaim` object — use `claim.timeframe` if present, else `claim.quarter`.

### `verify_claim()` Signature

```python
async def verify_claim(
    claim_id: str,
    claim_quarter: str,
    claim_metric: str,
    target_value: str,
    target_unit: str | None,
    ticker: str,
    job_id: str,
    raw_quote: str = "",
    timeframe: str = "",
) -> VerificationResult:
```

### INSUFFICIENT_DATA Helper

Extract a helper to avoid repeating the insert+return pattern:

```python
async def _insufficient_data(claim_id: str, reason: str, actuals_quarter: str) -> VerificationResult:
    verdict_id = await insert_verdict(claim_id=claim_id, verdict_type="INSUFFICIENT_DATA")
    return VerificationResult(
        claim_id=claim_id,
        verdict_id=verdict_id,
        verdict_type="INSUFFICIENT_DATA",
        actual_value=None,
        actuals_quarter=actuals_quarter,
        mapping_rationale=reason,
    )
```

### `analysis_router.py` Diff — Precise Changes

Only these lines change in `_do_extraction()`:

1. **Add import at top of file:**
   ```python
   from src.services.verification_service import verify_claim
   ```

2. **Capture claim_ids** (currently unused return value):
   ```python
   # BEFORE:
   await insert_claim_batch(claim_dicts)
   
   # AFTER:
   claim_ids = await insert_claim_batch(claim_dicts)
   ```

3. **Add verification loop** immediately after the `claims-extracted` `emit_progress` call:
   ```python
   for claim_id, claim in zip(claim_ids, result.claims):
       verification_result = await verify_claim(
           claim_id=claim_id,
           claim_quarter=claim.quarter,
           claim_metric=claim.metric,
           target_value=claim.target_value,
           target_unit=claim.target_unit,
           ticker=ticker,
           job_id=job_id,
           raw_quote=claim.raw_quote,
           timeframe=claim.timeframe,
       )
       step += 1
       await emit_progress(
           ProgressEvent(
               event="claim-verified",
               jobId=job_id,
               stepIndex=step,
               totalSteps=total_steps,
               message=(
                   f"Verified {claim.metric} for {ticker} {claim.quarter}: "
                   f"{verification_result.verdict_type}"
               ),
               timestamp=datetime.now(timezone.utc).isoformat(),
           )
       )
   ```

**Important:** The `step` increment happens BEFORE the `claim-verified` emit (not after) — step was already incremented at the end of the transcript loop (`step += 1`). Start verification `step` from the current value of `step` at that point.

Actually, looking at the existing loop:
```python
step = 1
for transcript in transcripts:
    ...
    step += 1  # at end of loop iteration
```

After the loop, `step = len(transcripts) + 1`. The `analysis-complete` uses `stepIndex=total_steps`. Verification events need stepIndex between `len(transcripts)` and `total_steps`. Since `total_steps = len(transcripts) + 1`, the verification events will have stepIndex > total_steps. This is acceptable for story 4.3 — the frontend clamps progress display.

The clean fix (recommended): increment `step` for each claim-verified event. The first verification event gets `stepIndex = len(transcripts) + 1` (same as total_steps), and subsequent ones exceed it. The `analysis-complete` event gets `stepIndex = total_steps` as before (no change to that existing line).

### LLM Response Parsing

Parse exactly like `extraction_service._parse_llm_response()` — strip markdown fences, parse JSON, validate:

```python
def _parse_verdict_response(content: str | None) -> str:
    """Return verdict_type string or 'INSUFFICIENT_DATA' on any parse failure."""
    if not content:
        return "INSUFFICIENT_DATA"
    text = content.strip()
    if text.startswith("```"):
        text = re.sub(r"^```\w*\n?", "", text)
        text = re.sub(r"\n?```\s*$", "", text).strip()
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return "INSUFFICIENT_DATA"
    verdict = data.get("verdict", "")
    if verdict not in {"DELIVERED", "MISSED", "INSUFFICIENT_DATA"}:
        return "INSUFFICIENT_DATA"
    return verdict
```

### Logger Name

```python
logger = get_logger("ml-sidecar.verification_service")
```

Do NOT include `timestamp` in the `extra` dict of any logger call — the formatter adds it automatically (learned from 4.1 review).

### Testing Pattern for `verify_claim`

Use the same mock helper pattern from `test_extraction.py`. For `test_verification.py`:

```python
from unittest.mock import AsyncMock, MagicMock, patch
import pytest

# Minimal claim fixture
CLAIM_FIXTURE = {
    "claim_id": "claim-uuid-123",
    "claim_quarter": "Q2-2024",
    "claim_metric": "revenue",
    "target_value": "380",
    "target_unit": "billion USD",
    "ticker": "AAPL",
    "job_id": "test-job-verify",
    "raw_quote": "We expect Q3 revenue to be $380 billion",
    "timeframe": "Q3 2024",
}

def _make_mock_alignment(status="ALIGNED", actuals_quarter="Q3-2024"):
    from src.models.alignment_models import AlignmentDecision
    return AlignmentDecision(
        ticker="AAPL",
        call_quarter="Q2-2024",
        actuals_quarter=actuals_quarter,
        filing_type="10-Q",
        filing_url="https://www.sec.gov/...",
        alignment_confidence="HIGH",
        mapping_rationale="Calendar quarter succession",
        status=status,
    )

def _make_mock_financials(status="SUCCESS", metrics=None):
    from src.models.financials_models import FinancialsResult, FinancialMetric
    if metrics is None:
        metrics = [FinancialMetric(
            ticker="AAPL", quarter="Q3-2024", metric_name="revenue",
            value="383000000000", unit="USD", section_reference="us-gaap/Revenues",
            filing_url="https://...", filing_type="10-Q", parse_status="SUCCESS",
        )]
    return FinancialsResult(ticker="AAPL", quarter="Q3-2024", filing_type="10-Q",
                             status=status, metrics=metrics, filing_url="https://...")

def _make_mock_llm_response(verdict="DELIVERED"):
    from src.core.llm.base import LLMResponse
    import json
    content = json.dumps({"verdict": verdict, "reasoning": "Values match", "matched_metric": "revenue"})
    return LLMResponse(content=content, tool_calls=[], model="claude-sonnet-4-6",
                       input_tokens=100, output_tokens=20)
```

**Critical mock targets** (patch these paths):
- `src.services.verification_service.align_call_to_actuals` — AsyncMock
- `src.services.verification_service.ingest_financial_actuals` — AsyncMock
- `src.core.llm.base._provider` — MagicMock with `.complete` as AsyncMock
- `src.services.verification_service.insert_verdict` — AsyncMock returning `"verdict-uuid-456"`

### conftest.py Update

Add to `conftest.py` `_mock_db_cache` fixture to also patch `insert_verdict` and `insert_reasoning_trace` to prevent accidental DB calls from tests:

```python
monkeypatch.setattr(
    "src.db.queries.insert_verdict",
    AsyncMock(return_value="mock-verdict-id"),
)
```

Actually, do NOT modify conftest.py globally — only the `test_verification.py` file should patch `insert_verdict` locally via `patch()` decorators or context managers. Patching it globally in conftest would break `test_analyze.py` tests that might need to verify verdict insertion behavior later.

### Regression Guard: Existing Tests Must Stay Green

**Do not change these files (they have existing passing tests):**
- `ml-sidecar/src/models/claim_models.py` — no changes needed
- `ml-sidecar/src/services/extraction_service.py` — no changes needed
- `ml-sidecar/src/db/queries.py` — no changes needed (insert_verdict already exists)

**`analysis_router.py` changes are additive only** — the extraction logic is unchanged; you're just using the return value of `insert_claim_batch` (which currently discards it) and adding a for-loop after the `claims-extracted` event.

### DB Schema Reference (No Migration Needed)

`verdicts` table already exists:
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
claim_id        uuid NOT NULL REFERENCES claims(id) ON DELETE RESTRICT
verdict_type    verdict_type NOT NULL  -- enum: DELIVERED/MISSED/INSUFFICIENT_DATA/PENDING/REVISED
delta           text                   -- NULL for story 4.3; story 4.4 fills this
confidence_score numeric(4,3)          -- NULL for story 4.3; story 4.4 fills this
is_correction   boolean NOT NULL DEFAULT false
corrects_verdict_id uuid REFERENCES verdicts(id)
created_at      timestamptz NOT NULL DEFAULT now()
```

`insert_verdict` in `queries.py` already casts `verdict_type` to the PG enum via `$3::verdict_type`. No schema changes needed.

### Story 4.2 Learnings to Follow

From the completed story 4.2 (relevant patterns to repeat):
- Dict mutation: use `{**item, "key": value}` spread, not `item["key"] = value`
- No `timestamp` in `extra` dict: formatter adds it — do NOT include `timestamp` in `logger.*(... extra={..., "timestamp": ...})`
- `claims-extracted` event only when claims > 0: the router already guards this — the new verification loop is inside the `if result.claims:` block, so it only runs when there are claims to verify

### Architecture Guardrails

From `architecture.md` enforcement guidelines:
- `SCREAMING_SNAKE_CASE` for verdict values at ALL layers — no lowercase/mixed case anywhere
- LLM provider abstraction: `verification_service.py` and `extraction_service.py` import only from `base.py`
- Silently swallowing errors is forbidden: every `except` block must log at `error` or `warning`, or produce `INSUFFICIENT_DATA`
- Never log: API keys, LLM prompt content, raw EDGAR response bodies, user-identifiable information

### References

- [`ml-sidecar/src/core/temporal_aligner.py`](ml-sidecar/src/core/temporal_aligner.py) — `align_call_to_actuals()` entry point
- [`ml-sidecar/src/services/financials_service.py`](ml-sidecar/src/services/financials_service.py) — `ingest_financial_actuals()`, `FinancialsResult`, `FinancialMetric`
- [`ml-sidecar/src/models/financials_models.py`](ml-sidecar/src/models/financials_models.py) — `FinancialMetric`, `FinancialsResult`, status literals
- [`ml-sidecar/src/models/alignment_models.py`](ml-sidecar/src/models/alignment_models.py) — `AlignmentDecision`, `AlignmentStatus`
- [`ml-sidecar/src/core/llm/base.py`](ml-sidecar/src/core/llm/base.py) — `BaseLLMProvider`, `LLMResponse`, `get_provider()`
- [`ml-sidecar/src/db/queries.py`](ml-sidecar/src/db/queries.py) — `insert_verdict()`, `VALID_VERDICT_TYPES`
- [`ml-sidecar/src/routers/analysis_router.py`](ml-sidecar/src/routers/analysis_router.py) — pipeline to extend (insert_claim_batch return value, claim-verified event)
- [`ml-sidecar/src/services/extraction_service.py`](ml-sidecar/src/services/extraction_service.py) — LLM call + cost logging pattern to mirror
- [`api/src/db/schema.ts`](api/src/db/schema.ts:94) — `verdicts` table schema authority (lines 94–125)
- [`ml-sidecar/tests/test_extraction.py`](ml-sidecar/tests/test_extraction.py) — mock provider pattern to mirror
- [`ml-sidecar/tests/conftest.py`](ml-sidecar/tests/conftest.py) — autouse fixtures; do NOT add global insert_verdict mock

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6 (story creation via bmad-create-story, 2026-06-06)

### Debug Log References

### Completion Notes List

### File List
