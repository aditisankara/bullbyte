# Story 4.4: Quantitative Delta Calculation & Verification Confidence Scoring

Status: ready-for-dev

## Story

As a **developer**,
I want the verification agent to calculate the quantitative delta between a claimed value and the actual reported value and assign a per-verdict confidence score,
so that every resolved claim shows precisely how far off (or on target) the promise was and how certain the verdict is.

## Acceptance Criteria

**AC1 — Delta calculated and stored for DELIVERED / MISSED verdicts**

Given a claim with a `target_value` and a retrieved actual value in the same unit
When the verification agent calculates the delta
Then `delta = actual_value - target_value` is computed and stored in `verdicts` as a signed numeric string (FR14)
And the delta is `NULL` for `INSUFFICIENT_DATA` verdicts — never a computed value based on missing data

**AC2 — Unit normalization before delta, INSUFFICIENT_DATA if impossible**

Given a claim where actual and claimed values are in different units
When the verification agent detects the mismatch
Then it normalizes to a common unit before computing the delta and records the normalization step in the `reasoning_traces` table
And if normalization is not possible it produces `INSUFFICIENT_DATA` with a log entry explaining the unit conflict

**AC3 — Confidence score assigned, stored, never suppressed**

Given a verdict is produced
When the confidence score is assigned
Then `confidence_score` reflects certainty: high (clear metric match), medium (inferred match), low (ambiguous metric or definition drift suspected) (FR18)
And `confidence_score` is stored as `NUMERIC(4,3)` between 0 and 1 — never a string label

**AC4 — Low-confidence verdicts written, not suppressed**

Given a low-confidence verdict
When it is written to PostgreSQL
Then the verdict record is still written — low-confidence verdicts are never suppressed (UX-DR5)
And `confidence_score` is stored so the API and UI can surface it distinctly (FR40)

**AC5 — `insert_verdict()` called with delta and confidence_score**

Given a verdict is produced for any claim
When `insert_verdict()` is called
Then it receives the `delta` and `confidence_score` keyword arguments
And `delta` is a signed string (e.g., `"3000000000.0"`) or `None`
And `confidence_score` is a `Decimal` between 0 and 1

**AC6 — VerificationResult carries delta and confidence_score**

Given `verify_claim()` returns a `VerificationResult`
When the caller reads the result
Then `result.delta` is the signed numeric string or `None`
And `result.confidence_score` is a float between 0 and 1

## Tasks / Subtasks

- [ ] Task 1: Update `ml-sidecar/src/models/verdict_models.py` (AC: 6)
  - [ ] Add `delta: str | None = None` field to `VerificationResult`
  - [ ] Add `confidence_score: float | None = None` field to `VerificationResult`
  - [ ] Both fields have defaults of `None` so existing callers don't break

- [ ] Task 2: Update `ml-sidecar/src/services/verification_service.py` (AC: 1, 2, 3, 4, 5, 6)
  - [ ] Add import: `from decimal import Decimal`
  - [ ] Add import: `from src.db.queries import insert_reasoning_trace`
  - [ ] Replace `_parse_verdict_response()` with `_parse_full_verdict_response()` returning `tuple[str, str | None, str]` — `(verdict_type, matched_metric_name, reasoning)`
  - [ ] Add `_parse_numeric_value(value_str, unit_str)` helper — see Dev Notes for exact implementation
  - [ ] Add `_compute_delta(target_value, target_unit, actual_value, actual_unit)` helper — returns `(str | None, bool)` where bool is `is_unit_conflict`
  - [ ] Add `_compute_confidence(matched_metric, claim_metric, verdict_type, best_metric_status)` helper — returns `Decimal`
  - [ ] Update `_insufficient_data()` helper to accept `confidence_score: Decimal` param and pass it to `insert_verdict()`; update returned `VerificationResult` to include `delta=None, confidence_score=float(confidence_score)`
  - [ ] Update `verify_claim()` — see Dev Notes for precise diff

- [ ] Task 3: Update `ml-sidecar/tests/test_verification.py` (AC: regression guard)
  - [ ] Add `insert_reasoning_trace` to the `_patch_all()` helper — patch `"src.services.verification_service.insert_reasoning_trace"` as `AsyncMock(return_value="trace-uuid")` so existing tests don't hit the DB when normalization triggers a trace write

- [ ] Task 4: Create `ml-sidecar/tests/test_delta_scoring.py` (AC: 1, 2, 3, 4, 5, 6)
  - [ ] `test_delta_calculated_for_delivered` — same-unit claim; assert `insert_verdict` receives non-None `delta` and `confidence_score`
  - [ ] `test_delta_null_for_insufficient_data` — INSUFFICIENT_DATA verdict; assert `insert_verdict` receives `delta=None`
  - [ ] `test_unit_normalization_billion_to_raw` — target `"380"` `"billion USD"`, actual `"383000000000"` `"USD"`; assert delta ≈ 3e9
  - [ ] `test_unit_conflict_produces_insufficient_data` — incompatible units (e.g. `"percent"` vs `"USD"`); assert verdict upgrades to `INSUFFICIENT_DATA`
  - [ ] `test_confidence_high_for_clear_match` — `matched_metric` contains `claim_metric` name + `parse_status="SUCCESS"`; assert `confidence_score >= 0.80`
  - [ ] `test_confidence_medium_for_inferred_match` — `matched_metric` is a different name; assert `0.40 <= confidence_score < 0.80`
  - [ ] `test_confidence_low_for_insufficient_data` — INSUFFICIENT_DATA verdict; assert `confidence_score <= 0.30`
  - [ ] `test_low_confidence_verdict_still_written` — assert `insert_verdict` called even for low-confidence result
  - [ ] `test_normalization_trace_written_when_units_differ` — target_unit="billion USD", actual metric unit="USD"; assert `insert_reasoning_trace` called with a non-None `result_summary`
  - [ ] `test_no_trace_when_same_units` — same units on both sides; assert `insert_reasoning_trace` NOT called

## Dev Notes

### Architecture: What This Story Changes

Story 4.4 is a **surgical extension** of the existing `verification_service.py` from story 4.3. No new services, routers, or DB migrations are needed. The story:
1. Extends `VerificationResult` to carry delta and confidence_score
2. Adds three pure helper functions (`_parse_numeric_value`, `_compute_delta`, `_compute_confidence`)
3. Updates `verify_claim()` to compute and persist delta + confidence, and log a reasoning trace when unit normalization occurs
4. Makes one additive change to `test_verification.py` — add `insert_reasoning_trace` mock to `_patch_all()`

### File Locations — Do Not Deviate

| File | Status | Path |
|------|--------|------|
| `verdict_models.py` | UPDATE | `ml-sidecar/src/models/verdict_models.py` |
| `verification_service.py` | UPDATE | `ml-sidecar/src/services/verification_service.py` |
| `test_verification.py` | UPDATE | `ml-sidecar/tests/test_verification.py` — `_patch_all()` only |
| `test_delta_scoring.py` | NEW | `ml-sidecar/tests/test_delta_scoring.py` |
| `queries.py` | NO CHANGE | `ml-sidecar/src/db/queries.py` — `insert_verdict(delta, confidence_score)` and `insert_reasoning_trace()` already exist |
| `analysis_router.py` | NO CHANGE | `verify_claim()` signature unchanged; new fields on `VerificationResult` are optional defaults |
| `schema.ts` | NO CHANGE | `verdicts.delta TEXT` and `verdicts.confidence_score NUMERIC(4,3)` already exist |

### DB Schema — Already Complete, No Migration Needed

From `api/src/db/schema.ts` (lines 94–125):
```sql
-- verdicts table (already exists from story 4.3)
delta           TEXT                   -- NULL in 4.3; story 4.4 fills this
confidence_score NUMERIC(4,3)          -- NULL in 4.3; story 4.4 fills this
-- constraint: confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 1)
```

`insert_verdict()` in `queries.py` already accepts `delta: str | None = None` and `confidence_score: Decimal | None = None` — story 4.3 just didn't pass them. Story 4.4 passes them.

`insert_reasoning_trace()` in `queries.py` already exists — signature:
```python
async def insert_reasoning_trace(
    *,
    verdict_id: str,
    step_index: int | None = None,
    tool_call: dict[str, Any] | None = None,
    result_summary: str | None = None,
    edgar_filing_ref: str | None = None,
) -> str:
```

### `verdict_models.py` — Exact Changes

```python
class VerificationResult(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    claim_id: str
    verdict_id: str
    verdict_type: VerdictType
    actual_value: str | None
    actuals_quarter: str
    mapping_rationale: str
    delta: str | None = None          # NEW — signed numeric string or None
    confidence_score: float | None = None  # NEW — 0.0–1.0 or None
```

### New Helper Functions

Add all three helpers BEFORE `verify_claim()`. Import `Decimal` at the top of the file.

**`_parse_full_verdict_response()` — replaces `_parse_verdict_response()`:**

```python
def _parse_full_verdict_response(content: str | None) -> tuple[str, str | None, str]:
    """Return (verdict_type, matched_metric_name, reasoning). Never raises."""
    if not content:
        return "INSUFFICIENT_DATA", None, ""
    text = content.strip()
    if text.startswith("```"):
        text = re.sub(r"^```\w*\n?", "", text)
        text = re.sub(r"\n?```\s*$", "", text).strip()
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return "INSUFFICIENT_DATA", None, ""
    verdict = data.get("verdict", "")
    if verdict not in {"DELIVERED", "MISSED", "INSUFFICIENT_DATA"}:
        verdict = "INSUFFICIENT_DATA"
    return verdict, data.get("matched_metric"), data.get("reasoning", "")
```

> **Critical:** Remove the old `_parse_verdict_response()` function entirely and update its single call site in `verify_claim()`. The private function is not imported anywhere outside this file.

**`_parse_numeric_value()` — unit-aware numeric parser:**

```python
def _parse_numeric_value(value_str: str, unit_str: str | None) -> tuple[float, str] | None:
    """Return (normalized_float, base_unit_tag) or None if value cannot be parsed.

    Normalizes common financial scale words to raw numbers:
      "billion" / "B"  → multiply by 1e9, tag "currency"
      "million" / "M"  → multiply by 1e6, tag "currency"
      "trillion" / "T" → multiply by 1e12, tag "currency"
      "%" / "percent"  → tag "percent" (no multiplier applied)
      otherwise        → tag "raw"
    """
    try:
        cleaned = value_str.strip().replace(",", "").replace("$", "").replace("%", "")
        num = float(cleaned)
    except (ValueError, TypeError, AttributeError):
        return None

    unit = (unit_str or "").lower()
    if "billion" in unit or (unit.endswith("b") and len(unit) <= 3):
        return (num * 1_000_000_000.0, "currency")
    if "million" in unit or (unit in {"m", "mm", "usd m", "$ m"}):
        return (num * 1_000_000.0, "currency")
    if "trillion" in unit or (unit.endswith("t") and len(unit) <= 3):
        return (num * 1_000_000_000_000.0, "currency")
    if "%" in (unit_str or "") or "percent" in unit:
        return (num, "percent")
    return (num, "raw")
```

**`_compute_delta()` — signed delta with conflict detection:**

```python
def _compute_delta(
    target_value: str,
    target_unit: str | None,
    actual_value: str | None,
    actual_unit: str | None,
) -> tuple[str | None, bool]:
    """Compute signed delta = actual - target.

    Returns (delta_str, is_unit_conflict).
    - delta_str: signed string (e.g. "3000000000.0") or None
    - is_unit_conflict: True means caller must produce INSUFFICIENT_DATA
    """
    if actual_value is None:
        return None, False  # No actual available — not a conflict

    parsed_target = _parse_numeric_value(target_value, target_unit)
    parsed_actual = _parse_numeric_value(actual_value, actual_unit)

    if parsed_target is None or parsed_actual is None:
        return None, False  # Unparseable — don't crash, just omit delta

    target_num, target_tag = parsed_target
    actual_num, actual_tag = parsed_actual

    # Incompatible unit families (e.g. percent vs currency/raw)
    meaningful = {"currency", "percent"}
    if target_tag in meaningful and actual_tag in meaningful and target_tag != actual_tag:
        return None, True  # Unit conflict

    delta = actual_num - target_num
    return str(delta), False
```

**`_compute_confidence()` — deterministic confidence scoring:**

```python
def _compute_confidence(
    matched_metric: str | None,
    claim_metric: str,
    verdict_type: str,
    best_metric_status: str | None,
) -> Decimal:
    """Compute confidence score (0–1) for the verdict.

    High (≥0.80):  clear metric name overlap + SUCCESS parse_status
    Medium (0.40–0.79): inferred match or PARTIAL parse_status
    Low (≤0.30):   INSUFFICIENT_DATA or no metric matched
    """
    if verdict_type == "INSUFFICIENT_DATA":
        return Decimal("0.20")

    if matched_metric is None:
        return Decimal("0.30")

    m_lower = matched_metric.lower()
    c_lower = claim_metric.lower()
    is_direct_match = c_lower in m_lower or m_lower in c_lower

    if is_direct_match:
        return Decimal("0.90") if best_metric_status == "SUCCESS" else Decimal("0.70")
    else:
        return Decimal("0.60") if best_metric_status == "SUCCESS" else Decimal("0.45")
```

### Updated `_insufficient_data()` Helper

```python
async def _insufficient_data(
    claim_id: str,
    reason: str,
    actuals_quarter: str,
    confidence_score: Decimal = Decimal("0.20"),
) -> VerificationResult:
    verdict_id = await insert_verdict(
        claim_id=claim_id,
        verdict_type="INSUFFICIENT_DATA",
        confidence_score=confidence_score,
    )
    return VerificationResult(
        claim_id=claim_id,
        verdict_id=verdict_id,
        verdict_type="INSUFFICIENT_DATA",
        actual_value=None,
        actuals_quarter=actuals_quarter,
        mapping_rationale=reason,
        delta=None,
        confidence_score=float(confidence_score),
    )
```

### `verify_claim()` — Precise Diff from Story 4.3

**Imports to add at the top of `verification_service.py`:**
```python
from decimal import Decimal
from src.db.queries import insert_reasoning_trace
```

**Replace Step 3 onwards.** Here is the complete replacement for everything after the LLM cost log in `verify_claim()`:

```python
    # ── Step 3 (continued): Parse full LLM response ───────────────────────────
    verdict_type, matched_metric_name, _reasoning = _parse_full_verdict_response(response.content)

    if verdict_type not in {"DELIVERED", "MISSED", "INSUFFICIENT_DATA"}:
        logger.warning(
            "LLM returned invalid verdict — defaulting to INSUFFICIENT_DATA",
            extra={"ticker": ticker, "actuals_quarter": actuals_quarter, "jobId": job_id},
        )
        verdict_type = "INSUFFICIENT_DATA"

    # ── Step 4: Find actual metric value ─────────────────────────────────────
    actual_value: str | None = None
    actual_unit: str | None = None
    best_metric_status: str | None = None

    if financials.metrics:
        # Prefer the metric the LLM named; fall back to name-based search
        candidates = financials.metrics
        matched_m = None
        if matched_metric_name:
            matched_m = next(
                (m for m in candidates if matched_metric_name.lower() in m.metric_name.lower()),
                None,
            )
        if matched_m is None:
            matched_m = next(
                (m for m in candidates if claim_metric.lower() in m.metric_name.lower()),
                None,
            )
        if matched_m is not None:
            actual_value = matched_m.value
            actual_unit = matched_m.unit
            best_metric_status = matched_m.parse_status

    # ── Step 5: Compute delta ─────────────────────────────────────────────────
    delta: str | None = None
    normalization_needed = False

    if verdict_type != "INSUFFICIENT_DATA":
        delta, is_unit_conflict = _compute_delta(
            target_value, target_unit, actual_value, actual_unit
        )
        if is_unit_conflict:
            logger.warning(
                "Unit conflict during delta calculation — upgrading to INSUFFICIENT_DATA",
                extra={
                    "ticker": ticker,
                    "claim_metric": claim_metric,
                    "target_unit": target_unit,
                    "actual_unit": actual_unit,
                    "jobId": job_id,
                },
            )
            return await _insufficient_data(
                claim_id=claim_id,
                reason=f"Unit conflict: cannot normalize {target_unit!r} to {actual_unit!r}",
                actuals_quarter=actuals_quarter,
            )
        # Flag if units differed so we log a normalization trace step after insert
        if (
            delta is not None
            and target_unit
            and actual_unit
            and target_unit.lower() != actual_unit.lower()
        ):
            normalization_needed = True

    # ── Step 6: Compute confidence score ─────────────────────────────────────
    confidence_score = _compute_confidence(
        matched_metric_name, claim_metric, verdict_type, best_metric_status
    )

    # ── Step 7: Persist verdict with delta and confidence ─────────────────────
    verdict_id = await insert_verdict(
        claim_id=claim_id,
        verdict_type=verdict_type,
        delta=delta,
        confidence_score=confidence_score,
    )

    # ── Step 8: Log normalization trace when units were converted ─────────────
    if normalization_needed:
        await insert_reasoning_trace(
            verdict_id=verdict_id,
            step_index=1,
            tool_call={
                "action": "unit_normalization",
                "claim_metric": claim_metric,
                "target_value": target_value,
                "target_unit": target_unit,
                "actual_value": actual_value,
                "actual_unit": actual_unit,
                "delta": delta,
            },
            result_summary=(
                f"Normalized units before delta: "
                f"target={target_value} ({target_unit}), "
                f"actual={actual_value} ({actual_unit}), "
                f"delta={delta}"
            ),
            edgar_filing_ref=None,
        )

    return VerificationResult(
        claim_id=claim_id,
        verdict_id=verdict_id,
        verdict_type=verdict_type,
        actual_value=actual_value,
        actuals_quarter=actuals_quarter,
        mapping_rationale=decision.mapping_rationale,
        delta=delta,
        confidence_score=float(confidence_score),
    )
```

### Critical: `test_verification.py` — Required Update to `_patch_all()`

**Why this is required:** Story 4.4 adds an `insert_reasoning_trace()` call inside `verify_claim()` whenever unit normalization occurs. The existing test fixtures in `test_verification.py` use `target_unit="billion USD"` and the mock financial metric uses `unit="USD"` — these differ, so the trace write fires. Without mocking, the call reaches `get_pool()` (not mocked outside the `client` fixture) and raises.

**Exact change to `_patch_all()` — add one `enter_context` call:**

```python
def _patch_all(
    alignment=None,
    financials=None,
    llm_response=None,
    insert_verdict_return: str = "verdict-uuid-456",
):
    from contextlib import ExitStack
    stack = ExitStack()
    stack.enter_context(patch(
        "src.services.verification_service.align_call_to_actuals",
        new=AsyncMock(return_value=alignment or _make_alignment()),
    ))
    stack.enter_context(patch(
        "src.services.verification_service.ingest_financial_actuals",
        new=AsyncMock(return_value=financials or _make_financials()),
    ))
    mock_provider = MagicMock()
    mock_provider.complete = AsyncMock(return_value=llm_response or _make_llm_response())
    stack.enter_context(patch("src.core.llm.base._provider", mock_provider))
    stack.enter_context(patch(
        "src.services.verification_service.insert_verdict",
        new=AsyncMock(return_value=insert_verdict_return),
    ))
    # NEW (story 4.4): patch insert_reasoning_trace so normalization trace doesn't hit DB
    stack.enter_context(patch(
        "src.services.verification_service.insert_reasoning_trace",
        new=AsyncMock(return_value="trace-uuid-mock"),
    ))
    return stack
```

The two tests that do NOT use `_patch_all()` (`test_insufficient_data_on_alignment_fetch_error`, `test_insufficient_data_on_filing_not_yet_available`, `test_insufficient_data_on_financials_fetch_error`) return INSUFFICIENT_DATA early — the trace code is never reached for those paths, so they are safe without the extra patch.

### `test_delta_scoring.py` — Key Test Patterns

**Shared setup helper** (copy `_make_alignment` and `_make_financials` from `test_verification.py`; same fixtures needed):

```python
# Shared patch helper for delta tests
def _patch_delta(
    target_value="383000000000",
    target_unit="USD",
    actual_metric_value="383000000000",
    actual_metric_unit="USD",
    llm_matched_metric="revenue",
    verdict="DELIVERED",
):
    """Return an ExitStack with all external calls patched."""
    from contextlib import ExitStack
    import json
    from unittest.mock import AsyncMock, MagicMock, patch

    content = json.dumps({
        "verdict": verdict,
        "reasoning": "Values match",
        "matched_metric": llm_matched_metric,
    })
    llm_resp = LLMResponse(content=content, tool_calls=[], model="claude-sonnet-4-6",
                            input_tokens=100, output_tokens=20)

    metric = FinancialMetric(
        ticker="AAPL", quarter="Q3-2024", metric_name="revenue",
        value=actual_metric_value, unit=actual_metric_unit,
        section_reference="us-gaap/Revenue", filing_url="https://...",
        filing_type="10-Q", parse_status="SUCCESS",
    )
    financials = FinancialsResult(
        ticker="AAPL", quarter="Q3-2024", filing_type="10-Q",
        status="SUCCESS", metrics=[metric], filing_url="https://...",
    )

    stack = ExitStack()
    stack.enter_context(patch("src.services.verification_service.align_call_to_actuals",
                               new=AsyncMock(return_value=_make_alignment())))
    stack.enter_context(patch("src.services.verification_service.ingest_financial_actuals",
                               new=AsyncMock(return_value=financials)))
    mock_prov = MagicMock()
    mock_prov.complete = AsyncMock(return_value=llm_resp)
    stack.enter_context(patch("src.core.llm.base._provider", mock_prov))
    stack.enter_context(patch("src.services.verification_service.insert_verdict",
                               new=AsyncMock(return_value="verdict-uuid-delta")))
    stack.enter_context(patch("src.services.verification_service.insert_reasoning_trace",
                               new=AsyncMock(return_value="trace-uuid-delta")))
    return stack
```

**Call kwargs capture pattern** (reuse the pattern from `test_verdict_stored_screaming_snake_case`):
```python
mock_insert = AsyncMock(return_value="verdict-uuid-delta")
with patch("src.services.verification_service.insert_verdict", new=mock_insert):
    ...
call_kwargs = mock_insert.call_args.kwargs
assert call_kwargs["delta"] == expected_delta
assert call_kwargs["confidence_score"] == expected_score
```

### Confidence Score Thresholds (Reference)

| Scenario | confidence_score |
|---|---|
| INSUFFICIENT_DATA (any path) | 0.20 |
| No matched_metric from LLM | 0.30 |
| Direct name match + SUCCESS parse | 0.90 |
| Direct name match + PARTIAL parse | 0.70 |
| Inferred match + SUCCESS parse | 0.60 |
| Inferred match + PARTIAL parse | 0.45 |

These thresholds are encoded in `_compute_confidence()`. Do NOT deviate from them — the tests assert on the expected tier.

### Delta Calculation Reference

| Claim target | Claim unit | Actual value | Actual unit | Expected delta |
|---|---|---|---|---|
| `"380"` | `"billion USD"` | `"383000000000"` | `"USD"` | `"3000000000.0"` |
| `"383000000000"` | `"USD"` | `"383000000000"` | `"USD"` | `"0.0"` |
| `"5.35"` | `"USD"` | `"5.49"` | `"USD"` | `"0.14"` |
| `"45"` | `"percent"` | `"45.5"` | `"%"` | `"0.5"` — percent vs % ALLOWED (same tag) |
| `"380"` | `"billion USD"` | `"45"` | `"percent"` | unit conflict → INSUFFICIENT_DATA |
| `"380"` | `"billion USD"` | `None` | N/A | `None` (not a conflict) |

`_parse_numeric_value` treats `"percent"`, `"%"`, and `"percent"` in unit_str all as tag `"percent"`. Do NOT treat this as a unit conflict.

### Logger Name — Do Not Change

```python
logger = get_logger("ml-sidecar.verification_service")
```

Do NOT add `timestamp` to any `extra` dict — the formatter adds it automatically (learned from 4.1 review; still applies).

### Regression Guard: Existing Tests Must Stay Green

**Only additive changes to these files:**
- `verdict_models.py` — new optional fields with defaults; `VerificationResult(**existing_kwargs)` still works
- `queries.py` — NO changes; `insert_verdict(delta=..., confidence_score=...)` already accepted
- `analysis_router.py` — NO changes; `verify_claim()` signature unchanged; `VerificationResult.delta` and `.confidence_score` are accessed nowhere in the router

**`test_verification.py` has one change:** `_patch_all()` gains one additional `enter_context`. All 9 existing tests use `_patch_all()` or the specific pattern for early-exit tests. The early-exit tests (alignment/financials failures) never reach the delta/trace code — their patches remain unchanged.

**Pre-existing failures unchanged:** `test_ingestion.py` (12, lxml missing), `test_yfinance_service.py` (6, yfinance missing).

### Architecture Guardrails (Must Follow)

- `SCREAMING_SNAKE_CASE` for `verdict_type` at ALL layers (already enforced by `insert_verdict` validation)
- `confidence_score` stored as `Decimal` when passed to `insert_verdict`, as `float` in `VerificationResult` (matches the `model_config` alias_generator for camelCase serialization)
- `delta` stored as `TEXT` in DB, as `str` in Python — never a float in the DB column
- Never log LLM prompt content, API keys, or raw EDGAR response bodies
- `insert_reasoning_trace` only called after `insert_verdict` succeeds (we have `verdict_id` before calling trace)
- Low-confidence verdicts MUST be written — never gated or suppressed by confidence threshold

### References

- [`ml-sidecar/src/models/verdict_models.py`](ml-sidecar/src/models/verdict_models.py) — file to extend
- [`ml-sidecar/src/services/verification_service.py`](ml-sidecar/src/services/verification_service.py) — file to extend (full current content is story 4.3 implementation)
- [`ml-sidecar/src/db/queries.py`](ml-sidecar/src/db/queries.py) — `insert_verdict()` (lines 98–138), `insert_reasoning_trace()` (lines 146–170); both accept all needed parameters
- [`api/src/db/schema.ts`](api/src/db/schema.ts:94) — `verdicts` table authority; `delta TEXT`, `confidence_score NUMERIC(4,3)` with 0–1 check constraint
- [`ml-sidecar/tests/test_verification.py`](ml-sidecar/tests/test_verification.py) — existing tests; `_patch_all()` helper needs one new entry
- [`ml-sidecar/tests/conftest.py`](ml-sidecar/tests/conftest.py) — autouse fixtures; `_mock_db_cache` does NOT mock `insert_reasoning_trace` or `get_pool` globally; do NOT modify conftest for this story
- [`ml-sidecar/src/models/financials_models.py`](ml-sidecar/src/models/financials_models.py) — `FinancialMetric.unit` and `.parse_status` fields used by `_compute_confidence`
- [`ml-sidecar/src/core/llm/base.py`](ml-sidecar/src/core/llm/base.py) — `LLMResponse` fields for cost logging

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6 (story creation via bmad-create-story, 2026-06-07)

### Debug Log References

### Completion Notes List

### File List
