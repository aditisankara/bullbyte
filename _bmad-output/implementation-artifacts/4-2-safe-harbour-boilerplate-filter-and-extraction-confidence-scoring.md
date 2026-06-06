# Story 4.2: Safe-Harbour Boilerplate Filter & Extraction Confidence Scoring

Status: done

## Story

As a **developer**,
I want the extraction agent to filter out safe-harbour boilerplate language and assign a per-claim confidence score,
so that only genuine forward-looking commitments enter the verification pipeline, each with a clear signal of how unambiguously they were stated.

## Acceptance Criteria

**AC1 — Safe-harbour filtering logged**

Given a transcript containing safe-harbour disclaimer text
When the extraction agent processes the transcript
Then no claims are extracted from boilerplate disclaimer passages (FR10)
And the filtering decision is logged at WARNING level with the skipped text segment and reason: `"safe_harbour_boilerplate"`

**AC2 — High confidence for clear statements**

Given a clearly stated numerical commitment (e.g. "We expect revenue of $380M in Q3")
When the extraction agent scores it
Then the claim receives an `extraction_confidence` score ≥ 0.80 (FR11)

**AC3 — Low confidence for hedged statements**

Given a hedged or vague numerical statement (e.g. "We think revenue could be somewhere around $380M")
When the extraction agent scores it
Then the claim receives an `extraction_confidence` score < 0.60
And the score and the hedging language are both preserved in the claim object

**AC4 — Confidence stored as NUMERIC 0–1**

Given any extracted claim
When it is persisted to PostgreSQL
Then `extraction_confidence` is stored as `NUMERIC` between 0 and 1 — never a percentage or string label
And the DB check constraint `extraction_confidence_range` (0 ≤ x ≤ 1) is never violated

## Tasks / Subtasks

- [x] Task 1: Add `extraction_confidence` and `BoilerplateSegment` to `claim_models.py` (AC: 2, 3, 4)
  - [x] Add `extraction_confidence: Decimal` field to `ExtractedClaim` with a `field_validator` enforcing `0 ≤ x ≤ 1`
  - [x] Add `BoilerplateSegment` Pydantic model: `raw_segment: str`, `reason: Literal["safe_harbour_boilerplate"]`; apply `model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)`
  - [x] Add `boilerplate_segments: list[BoilerplateSegment] = []` field to `ExtractionResult`

- [x] Task 2: Update `_SYSTEM_PROMPT` in `extraction_service.py` (AC: 1, 2, 3)
  - [x] Change LLM output format from flat array to a JSON object: `{"claims": [...], "boilerplate": [...]}`
  - [x] Add `"extraction_confidence"` to the claim field schema in the prompt: a float 0.0–1.0
  - [x] Add scoring guidance in the prompt: ≥ 0.80 for explicitly stated, specific, unhedged numbers; < 0.60 for hedged language ("could be", "approximately", "we think", "somewhere around"); 0.60–0.79 for moderately certain statements
  - [x] Add `"boilerplate"` array to the prompt schema: each entry is `{"raw_segment": "<text>", "reason": "safe_harbour_boilerplate"}`; instruct LLM to include safe-harbour disclaimer passages here instead of silently dropping them

- [x] Task 3: Update `_parse_llm_response()` in `extraction_service.py` (AC: 1, 2, 3, 4)
  - [x] After JSON parsing, detect whether the top-level value is a dict (new format) or list (legacy compat): if list, treat as `{"claims": <list>, "boilerplate": []}`
  - [x] Parse `claims` array from the dict exactly as before, producing `list[ExtractedClaim]`; `ExtractedClaim` now requires `extraction_confidence` — missing field produces `ExtractionError`
  - [x] Parse `boilerplate` array from the dict into `list[BoilerplateSegment]`; invalid entries are logged and skipped (never crash)
  - [x] For each `BoilerplateSegment`, emit a `logger.warning("Safe-harbour boilerplate filtered", extra={"raw_segment": seg.raw_segment[:300], "reason": seg.reason, "ticker": ticker, "quarter": quarter, "jobId": job_id})` — callers must pass ticker/quarter/job_id to `_parse_llm_response` for this
  - [x] Update `_parse_llm_response` signature to accept `ticker: str`, `quarter: str`, `job_id: str` (needed for boilerplate log context)
  - [x] Return type changes from `tuple[list[ExtractedClaim], list[ExtractionError]]` to `tuple[list[ExtractedClaim], list[ExtractionError], list[BoilerplateSegment]]`

- [x] Task 4: Update `extract_claims()` in `extraction_service.py` (AC: 1)
  - [x] Pass `ticker`, `quarter`, `job_id` to the updated `_parse_llm_response()`
  - [x] Unpack the new 3-tuple return: `claims, errors, boilerplate = _parse_llm_response(...)`
  - [x] Include `boilerplate_segments=boilerplate` in the returned `ExtractionResult`

- [x] Task 5: Update `analysis_router.py` to use real confidence scores (AC: 4)
  - [x] In the claim dict construction (inside `_do_extraction`), replace `"extraction_confidence": Decimal("0.5")` stub with `"extraction_confidence": Decimal(str(claim.extraction_confidence))`
  - [x] `Decimal(str(...))` is required because asyncpg expects `Decimal`, not `float`, and Pydantic may have stored it as `Decimal` already — `str()` round-trip is safe either way

- [x] Task 6: Update `test_extraction.py` fixtures for new LLM response format (AC: 1, 2, 3)
  - [x] Update `VALID_LLM_JSON` fixture to new dict format: `{"claims": [...], "boilerplate": []}` where each claim includes `"extraction_confidence": 0.85`
  - [x] Update `PARTIAL_LLM_JSON` fixture similarly
  - [x] Update `test_extraction_returns_structured_claims` to assert `first.extraction_confidence >= Decimal("0.80")` (or any valid value from fixture)
  - [x] Update `test_insert_claim_batch_persists_all` claim dicts to use a real `Decimal` value (not `Decimal("0.5")` — pick `Decimal("0.85")`)

- [x] Task 7: Write tests in `ml-sidecar/tests/test_confidence_scoring.py` (AC: 1, 2, 3, 4)
  - [x] `test_clear_claim_receives_high_confidence` — mock provider returns claim with `extraction_confidence: 0.90`; assert result claim has `extraction_confidence >= Decimal("0.80")`
  - [x] `test_hedged_claim_receives_low_confidence` — mock provider returns claim with `extraction_confidence: 0.45`; assert result claim has `extraction_confidence < Decimal("0.60")`
  - [x] `test_boilerplate_filtered_and_logged` — mock provider returns `{"claims": [], "boilerplate": [{"raw_segment": "These forward-looking statements involve risks...", "reason": "safe_harbour_boilerplate"}]}`; assert `result.boilerplate_segments` has 1 entry and `caplog` contains "Safe-harbour boilerplate filtered"
  - [x] `test_confidence_out_of_range_produces_error` — mock provider returns claim with `extraction_confidence: 1.5`; assert it produces `ExtractionError` (Pydantic validation fails), not a persisted claim
  - [x] `test_analysis_router_uses_real_confidence` — assert the dict built in `_do_extraction` does NOT contain `Decimal("0.5")` hardcoded; use `ast.parse` or `inspect.getsource` to verify the stub is gone (same pattern as `test_llm_called_via_abstraction_only`)

### Review Findings

- [x] [Review][Decision→Patch] Legacy flat-array compat path removed — `extraction_confidence` is now required; legacy path was dead code producing 100% ExtractionErrors. Removed; parser now requires dict format exclusively. [`ml-sidecar/src/services/extraction_service.py`]

- [x] [Review][Patch] Silent discard of malformed boilerplate entries with no observability — added `logger.debug` for non-dict boilerplate items and replaced bare `except: pass` with `logger.debug` call including error context. [`ml-sidecar/src/services/extraction_service.py`]

- [x] [Review][Patch] LLM returns malformatted but non-empty quarter — fallback not applied, claim silently dropped — extended fallback condition to also check `re.match(r"^Q[1-4]-\d{4}$", ...)`, rescuing claims with present-but-invalid quarter strings. [`ml-sidecar/src/services/extraction_service.py`]

- [x] [Review][Patch] `boilerplate_raw` or `claim_list` not validated as list — added `isinstance` guards: `claim_list` non-list returns error; `boilerplate_raw` non-list logs debug and falls back to `[]`. [`ml-sidecar/src/services/extraction_service.py`]

- [x] [Review][Defer] `insert_claim_batch` rolls back entire batch on single claim failure — pre-existing transaction design in `queries.py`; any DB constraint violation (e.g., duplicate run) loses all claims for that transcript [`ml-sidecar/src/db/queries.py`] — deferred, pre-existing

- [x] [Review][Defer] DB check constraint `extraction_confidence_range` existence not confirmed in diff — dev notes assert "column exists, no migration needed"; confirmed pre-existing per story design [`api/src/db/schema.ts`] — deferred, pre-existing

## Dev Notes

### What Story 4.1 Left Behind (Build On This)

Story 4.1 established all the patterns this story extends:
- `ExtractedClaim` Pydantic model in `claim_models.py` — **you are adding `extraction_confidence: Decimal` to it**
- `_SYSTEM_PROMPT` and `_parse_llm_response()` in `extraction_service.py` — **you are modifying both**
- `_do_extraction()` in `analysis_router.py` — **you are changing one line: remove the `Decimal("0.5")` stub**
- `insert_claim_batch()` in `queries.py` — **no changes needed here; it already accepts `extraction_confidence` as a dict key**

The DB schema (`api/src/db/schema.ts`) already has:
```ts
extractionConfidence: numeric('extraction_confidence', { precision: 4, scale: 3 }).notNull()
// + check constraint: extraction_confidence_range (>= 0 AND <= 1)
```
**No DB migration is needed.** The column exists. Story 4.1 was inserting the stub value `0.5` to satisfy the NOT NULL constraint.

### Model Changes (`claim_models.py`)

Add to `ExtractedClaim` after the `quarter` field:

```python
from decimal import Decimal
from pydantic import field_validator

extraction_confidence: Decimal

@field_validator("extraction_confidence")
@classmethod
def confidence_range(cls, v: Decimal) -> Decimal:
    if not (Decimal("0") <= v <= Decimal("1")):
        raise ValueError(f"extraction_confidence must be 0–1, got: {v}")
    return v
```

New model to add:

```python
class BoilerplateSegment(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)
    raw_segment: str
    reason: Literal["safe_harbour_boilerplate"]
```

Update `ExtractionResult`:

```python
class ExtractionResult(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)
    claims: list[ExtractedClaim]
    errors: list[ExtractionError]
    boilerplate_segments: list[BoilerplateSegment] = []  # NEW
    ticker: str
    quarter: str
```

### Prompt Format Change (`extraction_service.py`)

The prompt must ask for a **JSON object** (not a bare array). Replace the current output instruction with:

```
Output ONLY a JSON object with exactly two keys:
{
  "claims": [ ...array of claim objects... ],
  "boilerplate": [ ...array of skipped boilerplate passages... ]
}

Each claim object:
{
  "raw_quote": "<verbatim sentence(s)>",
  "claim_type": "<revenue|earnings|margin|guidance|growth|other>",
  "metric": "<concise metric name>",
  "target_value": "<the specific number>",
  "target_unit": "<unit or null>",
  "timeframe": "<predicted period>",
  "speaker": "<speaker name or null>",
  "quarter": "<Q[1-4]-YYYY format>",
  "extraction_confidence": <float 0.0–1.0>
}

Confidence scoring rules:
- 0.80–1.00: Explicitly stated specific number, no hedging language ("We expect", "We guide to", "We will deliver")
- 0.60–0.79: Moderately certain ("We anticipate", "approximately X", clear context)
- 0.00–0.59: Hedged or uncertain ("could be", "we think", "somewhere around", conditional language)

Each boilerplate entry:
{
  "raw_segment": "<the boilerplate text>",
  "reason": "safe_harbour_boilerplate"
}

Do not output markdown, explanations, or anything outside the JSON object.
```

### `_parse_llm_response()` Changes

Updated signature:
```python
def _parse_llm_response(
    response: LLMResponse,
    quarter: str,
    ticker: str,
    job_id: str,
) -> tuple[list[ExtractedClaim], list[ExtractionError], list[BoilerplateSegment]]:
```

After JSON parsing, handle both formats:
```python
if isinstance(raw_data, list):
    # legacy / fallback: flat array (no boilerplate)
    claim_list = raw_data
    boilerplate_raw = []
elif isinstance(raw_data, dict):
    claim_list = raw_data.get("claims", [])
    boilerplate_raw = raw_data.get("boilerplate", [])
else:
    errors.append(ExtractionError(...))
    return [], errors, []
```

For each boilerplate entry, validate and log:
```python
boilerplate: list[BoilerplateSegment] = []
for item in boilerplate_raw:
    if not isinstance(item, dict):
        continue  # skip malformed entries silently
    try:
        seg = BoilerplateSegment(**item)
        boilerplate.append(seg)
        logger.warning(
            "Safe-harbour boilerplate filtered",
            extra={
                "raw_segment": seg.raw_segment[:300],
                "reason": seg.reason,
                "ticker": ticker,
                "quarter": quarter,
                "jobId": job_id,
            },
        )
    except Exception:
        pass  # non-fatal: malformed boilerplate entry is skipped
```

### `analysis_router.py` Change

In `_do_extraction`, find the claim dict construction and change exactly one line:

```python
# BEFORE (story 4.1 stub):
"extraction_confidence": Decimal("0.5"),

# AFTER (story 4.2 real score):
"extraction_confidence": Decimal(str(claim.extraction_confidence)),
```

`claim.extraction_confidence` is already a `Decimal` from Pydantic coercion, but `str()` round-trip is safe and avoids any float precision issues.

### Test Fixture Updates (`test_extraction.py`)

`VALID_LLM_JSON` must become:
```json
{
  "claims": [
    {
      "raw_quote": "We expect Q3 revenue to be approximately $120 billion",
      "claim_type": "revenue",
      "metric": "Q3 revenue",
      "target_value": "120",
      "target_unit": "billion USD",
      "timeframe": "Q3 2024",
      "speaker": "Tim Cook - CEO",
      "quarter": "Q2-2024",
      "extraction_confidence": 0.85
    },
    {
      "raw_quote": "We anticipate gross margin of approximately 46 percent for the September quarter",
      "claim_type": "margin",
      "metric": "gross margin",
      "target_value": "46",
      "target_unit": "percent",
      "timeframe": "Q3 2024",
      "speaker": "Luca Maestri - CFO",
      "quarter": "Q2-2024",
      "extraction_confidence": 0.75
    }
  ],
  "boilerplate": []
}
```

`PARTIAL_LLM_JSON` format: wrap the existing claim in `{"claims": [<valid>], "boilerplate": []}` with `extraction_confidence: 0.85` added to the valid claim. Keep `"this is not a valid object"` inside the `claims` array so `test_extraction_no_silent_drops` still exercises the same path.

### Pydantic Coercion of `extraction_confidence`

Pydantic v2 will coerce a JSON `float` (e.g., `0.85`) to `Decimal` automatically when the field type is `Decimal`. The `field_validator` runs after coercion, so it receives a `Decimal`. No explicit `Decimal(str(v))` needed in the model — Pydantic handles it.

### No Changes to `queries.py`

`insert_claim_batch` already accepts `extraction_confidence` as a dict key and passes it as a `Decimal` to asyncpg. The TODO comment about `claim_type`, `target_unit`, `timeframe` columns remains — those are still not in the DB schema.

### Architecture Conventions to Follow

- **File locations**: same files as story 4.1 — no new files except the test file
- **New test file**: `ml-sidecar/tests/test_confidence_scoring.py` (mirrors `test_extraction.py` pattern)
- **Logger name**: `get_logger("ml-sidecar.extraction_service")` — same logger, boilerplate warning uses `logger.warning`
- **Pydantic v2 + `ConfigDict(alias_generator=to_camel)`** on all new models
- **`Decimal` not `float`** for any field that maps to a Postgres `NUMERIC` column
- **No ORM in sidecar** — `queries.py` only, no SQLAlchemy

### Previous Story Review Findings Relevant to 4.2

From story 4.1 code review (all already fixed in 4.1, but patterns to repeat):
- **Dict mutation in `_parse_llm_response`**: use `{**item, "quarter": quarter}` spread, not `item["quarter"] = quarter` — already done in 4.1; follow same pattern for any new field injection
- **No `timestamp` in `extra` dict**: formatter adds it automatically — do NOT include `timestamp` in the `extra` kwarg of any logger call
- **`claims-extracted` event only when claims > 0**: the router only emits this event when `result.claims` is non-empty — maintain this for boilerplate-only quarters too

### Testing Pattern (from `test_extraction.py`)

```python
@pytest.mark.asyncio
async def test_boilerplate_filtered_and_logged(caplog):
    import logging

    boilerplate_response = json.dumps({
        "claims": [],
        "boilerplate": [{"raw_segment": "These forward-looking statements involve risks...", "reason": "safe_harbour_boilerplate"}]
    })
    mock_provider = _make_mock_provider(boilerplate_response)

    with patch("src.core.llm.base._provider", mock_provider):
        with caplog.at_level(logging.WARNING, logger="ml-sidecar.extraction_service"):
            from src.services.extraction_service import extract_claims
            result = await extract_claims(
                transcript_text=TRANSCRIPT_FIXTURE,
                ticker="AAPL",
                quarter="Q2-2024",
                job_id="test-job-boilerplate",
            )

    assert len(result.claims) == 0
    assert len(result.boilerplate_segments) == 1
    assert result.boilerplate_segments[0].reason == "safe_harbour_boilerplate"
    boilerplate_records = [r for r in caplog.records if "Safe-harbour boilerplate filtered" in r.getMessage()]
    assert len(boilerplate_records) == 1
```

Use `_make_mock_provider` from `test_extraction.py` (import it or duplicate the helper in the new test file — prefer import if in the same `tests/` package).

### References

- [`ml-sidecar/src/models/claim_models.py`](ml-sidecar/src/models/claim_models.py) — `ExtractedClaim`, `ExtractionResult`, `ExtractionError` models to modify
- [`ml-sidecar/src/services/extraction_service.py`](ml-sidecar/src/services/extraction_service.py) — `_SYSTEM_PROMPT`, `_parse_llm_response()`, `extract_claims()` to modify
- [`ml-sidecar/src/routers/analysis_router.py`](ml-sidecar/src/routers/analysis_router.py) — `_do_extraction()` one-line change (line ~136)
- [`ml-sidecar/src/db/queries.py`](ml-sidecar/src/db/queries.py) — `insert_claim_batch()` — no changes needed
- [`ml-sidecar/tests/test_extraction.py`](ml-sidecar/tests/test_extraction.py) — fixtures and assertions to update
- [`api/src/db/schema.ts`](api/src/db/schema.ts) — `claims` table schema authority; `extraction_confidence numeric(4,3)` with 0–1 check constraint
- [`_bmad-output/planning-artifacts/epics.md#Story 4.2`](_bmad-output/planning-artifacts/epics.md) — acceptance criteria
- [`_bmad-output/planning-artifacts/architecture.md#Naming Patterns`](_bmad-output/planning-artifacts/architecture.md) — `confidence_score` column naming convention (snake_case)
- [`_bmad-output/implementation-artifacts/4-1-llm-based-numerical-claim-extraction-agent.md`](_bmad-output/implementation-artifacts/4-1-llm-based-numerical-claim-extraction-agent.md) — story 4.1 dev notes, review findings, patterns to follow

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6 (story creation via bmad-create-story, 2026-06-06)

### Debug Log References

### Completion Notes List

- Implemented all 7 tasks; 20/20 tests pass, 0 regressions introduced.
- `ExtractedClaim` now requires `extraction_confidence: Decimal` (0–1) validated by `field_validator`; Pydantic v2 coerces JSON float → Decimal automatically.
- New `BoilerplateSegment` model + `boilerplate_segments` field on `ExtractionResult` (defaults to `[]`).
- `_SYSTEM_PROMPT` updated to request `{"claims": [...], "boilerplate": [...]}` JSON object with per-claim confidence scoring rules.
- `_parse_llm_response` extended with `ticker`/`quarter`/`job_id` params; handles legacy flat-array format for backward compat; logs WARNING per boilerplate segment (non-fatal on malformed entries).
- `analysis_router._do_extraction` stub `Decimal("0.5")` replaced with `Decimal(str(claim.extraction_confidence))`.
- Legacy flat-array format still accepted by `_parse_llm_response` (treated as zero boilerplate).
- Pre-existing `test_ingestion.py` failures (12 tests, `lxml` missing) are unrelated to story 4.2 and were present before this branch.

### File List

- `ml-sidecar/src/models/claim_models.py`
- `ml-sidecar/src/services/extraction_service.py`
- `ml-sidecar/src/routers/analysis_router.py`
- `ml-sidecar/tests/test_extraction.py`
- `ml-sidecar/tests/test_confidence_scoring.py` (new)
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/implementation-artifacts/4-2-safe-harbour-boilerplate-filter-and-extraction-confidence-scoring.md`
