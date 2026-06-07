# Story 4.5: Structured Reasoning Trace Logger

Status: ready-for-dev

## Story

As a **developer**,
I want every verification tool call and decision step logged as an ordered, structured reasoning trace in PostgreSQL,
so that every verdict has a fully auditable, human-readable record of exactly how BullByte reached its conclusion.

## Acceptance Criteria

**AC1 — Every tool call step logged with correct fields**

Given the verification agent runs for a claim
When each tool call completes (temporal alignment, EDGAR actuals fetch, LLM verdict reasoning, unit normalization where applicable)
Then a record is written to `reasoning_traces` with: `verdict_id`, `step_index`, `tool_call` (jsonb), `result_summary`, `edgar_filing_ref` (where applicable), `created_at` (FR17)
And `step_index` is a sequential integer starting at 1 — the full ordered trace is reconstructable from the DB

**AC2 — EDGAR filing ref present for EDGAR-involving steps**

Given an EDGAR filing is referenced in a reasoning step (temporal alignment or financials fetch)
When the trace record is written
Then `edgar_filing_ref` contains the filing type, ticker, quarter, and URL in the format `"{filing_type} | {ticker} | {quarter} | {url}"` — sufficient for a user to navigate to the source (FR38, FR39)
And `edgar_filing_ref` is `None` when the step does not reference an EDGAR filing (LLM step, unit normalization step)

**AC3 — Every tool call present; no silent or suppressed steps**

Given a verification run completes (any verdict, including INSUFFICIENT_DATA)
When a developer queries `reasoning_traces` for that verdict
Then every tool call step that ran is present — no silent tool calls, no suppressed steps (FR17)
And the trace for an INSUFFICIENT_DATA verdict (any path) contains at least one step recording why the verdict was issued

**AC4 — Error steps written as structured entries**

Given the verification agent encounters an error mid-trace (alignment failure, financials failure, unit conflict)
When the error is handled
Then the failed step is written as a structured trace entry with `tool_call: { "action": "...", "status": "...", "reason": "..." }`
And partial traces do not exist in the DB — the trace is always written to a terminal state before `verify_claim()` returns

**AC5 — Traces written for all INSUFFICIENT_DATA paths**

Given `verify_claim()` returns INSUFFICIENT_DATA via any early-exit path (alignment failure, financials failure, unit conflict)
When the `VerificationResult` is returned
Then all trace steps that ran up to and including the failure step are written to `reasoning_traces` using the verdict_id created by `_insufficient_data()`
And the error step is the final entry in the trace

**AC6 — Unit normalization trace uses correct sequential step_index**

Given a claim where unit normalization was needed (units differ but compatible)
When traces are written
Then the unit normalization step appears AFTER the LLM verdict step — its `step_index` is the final step, not hardcoded to 1
And the normalization step's `tool_call` contains: `action`, `claim_metric`, `target_value`, `target_unit`, `actual_value`, `actual_unit`, `delta`

**AC7 — No normalization trace step when units are identical**

Given a claim where target and actual units are already identical
When traces are written
Then no trace step with `tool_call.action == "unit_normalization"` is written — only the standard steps (alignment, financials, LLM)

## Tasks / Subtasks

- [ ] Task 1: Add `_make_filing_ref()` helper to `verification_service.py` (AC: 2)
  - [ ] Define `_make_filing_ref(filing_type, ticker, quarter, url) -> str | None`
  - [ ] Return `None` if `url` is falsy
  - [ ] Return `"{filing_type} | {ticker} | {quarter} | {url}"` otherwise

- [ ] Task 2: Update `_insufficient_data()` to accept and flush trace steps (AC: 4, 5)
  - [ ] Add `traces: list[dict] | None = None` parameter (default None — backward compatible)
  - [ ] After `insert_verdict()` succeeds and `verdict_id` is obtained, write each trace step via `insert_reasoning_trace()` using enumerate(traces, 1) for step_index
  - [ ] Existing callers with no `traces` arg are unaffected

- [ ] Task 3: Refactor `verify_claim()` to collect and flush traces (AC: 1, 2, 3, 5, 6, 7)
  - [ ] Add `_traces: list[dict] = []` at the top of `verify_claim()`
  - [ ] After `align_call_to_actuals()` completes, append alignment trace entry (step details in Dev Notes)
  - [ ] Pass `traces=_traces` to `_insufficient_data()` on alignment failure early exit
  - [ ] After `ingest_financial_actuals()` completes, append financials trace entry
  - [ ] Pass `traces=_traces` to `_insufficient_data()` on financials failure early exit
  - [ ] After LLM `provider.complete()` and `_parse_full_verdict_response()`, append LLM verdict trace entry
  - [ ] When unit conflict detected (`is_unit_conflict=True`), append unit_conflict trace entry then pass `traces=_traces` to `_insufficient_data()`
  - [ ] Remove the old `normalization_needed` flag and Step 8 block from 4.4
  - [ ] If `delta is not None` and units differ, append unit_normalization trace entry to `_traces` BEFORE calling `insert_verdict()`
  - [ ] After `insert_verdict()` returns `verdict_id`, write all accumulated `_traces` via `insert_reasoning_trace()` in a loop using enumerate(1)

- [ ] Task 4: Update `ml-sidecar/tests/test_verification.py` (AC: regression guard)
  - [ ] Add `insert_reasoning_trace` mock to `test_insufficient_data_on_alignment_fetch_error` (see Dev Notes for exact patch)
  - [ ] Add `insert_reasoning_trace` mock to `test_insufficient_data_on_filing_not_yet_available` (see Dev Notes)
  - [ ] Add `insert_reasoning_trace` mock to `test_insufficient_data_on_financials_fetch_error` (see Dev Notes)
  - [ ] No changes to `_patch_all()` — it already patches `insert_reasoning_trace` (added in story 4.4)

- [ ] Task 5: Update `ml-sidecar/tests/test_delta_scoring.py` (AC: regression guard)
  - [ ] Update `test_normalization_trace_written_when_units_differ` — assert that at least one `insert_reasoning_trace` call has `tool_call["action"] == "unit_normalization"` (not `call_count == 1`)
  - [ ] Update `test_no_trace_when_same_units` — assert that no `insert_reasoning_trace` call has `tool_call["action"] == "unit_normalization"` (not `assert_not_called()`)

- [ ] Task 6: Create `ml-sidecar/tests/test_reasoning_trace.py` (AC: 1, 2, 3, 4, 5, 6, 7)
  - [ ] `test_full_trace_steps_logged_on_delivered` — DELIVERED verdict with different units; assert 4 `insert_reasoning_trace` calls with step_index 1, 2, 3, 4
  - [ ] `test_full_trace_steps_same_units` — DELIVERED verdict, same units; assert exactly 3 calls (no normalization step)
  - [ ] `test_alignment_failure_writes_one_trace_step` — FETCH_ERROR alignment; assert 1 call at step_index 1 with action `temporal_alignment`
  - [ ] `test_financials_failure_writes_two_trace_steps` — SUCCESS alignment, FETCH_ERROR financials; assert 2 calls
  - [ ] `test_unit_conflict_writes_traces_including_conflict_step` — unit conflict; assert 4 calls including one with action `unit_conflict`
  - [ ] `test_edgar_filing_ref_format_on_alignment_step` — assert edgar_filing_ref matches `"{filing_type} | {ticker} | {quarter} | {url}"` format
  - [ ] `test_edgar_filing_ref_none_on_llm_step` — LLM step has `edgar_filing_ref=None`
  - [ ] `test_step_indices_sequential_from_1` — assert step_indices passed to `insert_reasoning_trace` are 1, 2, 3, ... with no gaps
  - [ ] `test_all_traces_share_same_verdict_id` — all `insert_reasoning_trace` calls use the same `verdict_id`

## Dev Notes

### Architecture: What This Story Changes

Story 4.5 is an **extension** of `verification_service.py` from stories 4.3 and 4.4. No new services, DB migrations, or schema changes are needed. The story:
1. Adds `_make_filing_ref()` pure helper
2. Extends `_insufficient_data()` with optional `traces` parameter
3. Refactors `verify_claim()` to accumulate trace steps inline and flush them after `insert_verdict()`
4. Replaces the hardcoded Step 8 normalization trace from 4.4 (step_index=1) with a position-aware approach

The `reasoning_traces` table already exists (story 1.2). `insert_reasoning_trace()` already exists in `queries.py` (used in story 4.4). No caller outside `verification_service.py` writes to `reasoning_traces` yet.

### File Locations — Do Not Deviate

| File | Status | Path |
|------|--------|------|
| `verification_service.py` | UPDATE | `ml-sidecar/src/services/verification_service.py` |
| `test_verification.py` | UPDATE | `ml-sidecar/tests/test_verification.py` — 3 early-exit tests only |
| `test_delta_scoring.py` | UPDATE | `ml-sidecar/tests/test_delta_scoring.py` — 2 normalization test assertions |
| `test_reasoning_trace.py` | NEW | `ml-sidecar/tests/test_reasoning_trace.py` |
| `queries.py` | NO CHANGE | `insert_reasoning_trace()` already complete |
| `schema.ts` | NO CHANGE | `reasoning_traces` table already exists |
| `verdict_models.py` | NO CHANGE | No new fields needed |
| `analysis_router.py` | NO CHANGE | Calls `verify_claim()`; return value unchanged |

### DB Schema — Already Complete, No Migration Needed

From `api/src/db/schema.ts` (lines 130–145):
```sql
reasoning_traces (
  id             UUID PK
  verdict_id     UUID NOT NULL REFERENCES verdicts(id) ON DELETE CASCADE
  step_index     INTEGER               -- sequential from 1
  tool_call      JSONB                 -- structured action payload
  result_summary TEXT                  -- human-readable summary
  edgar_filing_ref TEXT                -- "{filing_type} | {ticker} | {quarter} | {url}" or NULL
  created_at     TIMESTAMPTZ DEFAULT NOW()
)
```

`insert_reasoning_trace()` in `queries.py` (lines 146–170) accepts all needed parameters.

### New Helper Function: `_make_filing_ref()`

Add BEFORE `_insufficient_data()`. No imports needed.

```python
def _make_filing_ref(filing_type: str, ticker: str, quarter: str, url: str) -> str | None:
    """Build a consistent EDGAR filing reference string for reasoning traces.

    Returns None if url is falsy (filing unavailable or not yet fetched).
    Format: "{filing_type} | {ticker} | {quarter} | {url}"
    """
    if not url:
        return None
    return f"{filing_type} | {ticker} | {quarter} | {url}"
```

### Updated `_insufficient_data()` — Exact Changes

```python
async def _insufficient_data(
    claim_id: str,
    reason: str,
    actuals_quarter: str,
    confidence_score: Decimal = Decimal("0.20"),
    traces: list[dict] | None = None,   # NEW — accumulated trace steps to flush
) -> VerificationResult:
    verdict_id = await insert_verdict(
        claim_id=claim_id,
        verdict_type="INSUFFICIENT_DATA",
        confidence_score=confidence_score,
    )
    if traces:
        for step_index, trace in enumerate(traces, 1):
            await insert_reasoning_trace(
                verdict_id=verdict_id,
                step_index=step_index,
                tool_call=trace.get("tool_call"),
                result_summary=trace.get("result_summary"),
                edgar_filing_ref=trace.get("edgar_filing_ref"),
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

### Refactored `verify_claim()` — Step-by-Step Diff

This replaces the entire `verify_claim()` body. The function signature is **unchanged**.

**Trace accumulation at Step 1 (after `align_call_to_actuals`):**

```python
    _traces: list[dict] = []

    # ── Step 1: Temporal alignment ────────────────────────────────────────────
    decision = await align_call_to_actuals(ticker, claim_quarter)
    _traces.append({
        "tool_call": {
            "action": "temporal_alignment",
            "ticker": ticker,
            "claim_quarter": claim_quarter,
            "actuals_quarter": decision.actuals_quarter,
            "filing_type": decision.filing_type,
            "status": decision.status,
            "alignment_confidence": decision.alignment_confidence,
        },
        "result_summary": (
            f"Aligned {claim_quarter} → {decision.actuals_quarter} "
            f"({decision.status}, {decision.alignment_confidence}): {decision.mapping_rationale}"
        ),
        "edgar_filing_ref": _make_filing_ref(
            decision.filing_type, ticker, decision.actuals_quarter, decision.filing_url
        ),
    })

    if decision.status == "FETCH_ERROR" or not decision.filing_url:
        logger.warning(
            "Temporal alignment failed — producing INSUFFICIENT_DATA",
            extra={
                "ticker": ticker,
                "claim_quarter": claim_quarter,
                "actuals_quarter": decision.actuals_quarter,
                "filing_url": decision.filing_url,
                "failure_reason": decision.mapping_rationale,
                "alignment_status": decision.status,
                "jobId": job_id,
            },
        )
        return await _insufficient_data(
            claim_id=claim_id,
            reason=f"Alignment failed: {decision.mapping_rationale}",
            actuals_quarter=decision.actuals_quarter,
            traces=_traces,
        )

    actuals_quarter = decision.actuals_quarter
```

**Trace accumulation at Step 2 (after `ingest_financial_actuals`):**

```python
    # ── Step 2: Fetch financial actuals ──────────────────────────────────────
    financials = await ingest_financial_actuals(ticker, actuals_quarter)
    _traces.append({
        "tool_call": {
            "action": "fetch_financial_actuals",
            "ticker": ticker,
            "actuals_quarter": actuals_quarter,
            "filing_type": financials.filing_type,
            "status": financials.status,
            "metrics_count": len(financials.metrics),
        },
        "result_summary": (
            f"Fetched {financials.filing_type} for {actuals_quarter}: "
            f"status={financials.status}, {len(financials.metrics)} metrics available"
        ),
        "edgar_filing_ref": _make_filing_ref(
            financials.filing_type, ticker, actuals_quarter, financials.filing_url
        ),
    })

    if financials.status in ("FETCH_ERROR", "FILING_NOT_YET_AVAILABLE"):
        logger.warning(
            "Financial actuals unavailable — producing INSUFFICIENT_DATA",
            extra={
                "ticker": ticker,
                "actuals_quarter": actuals_quarter,
                "filing_url": financials.filing_url,
                "failure_reason": financials.status,
                "jobId": job_id,
            },
        )
        return await _insufficient_data(
            claim_id=claim_id,
            reason=f"Financials unavailable: {financials.status}",
            actuals_quarter=actuals_quarter,
            traces=_traces,
        )
```

**Trace accumulation at Step 3 (after LLM call and parse):**

```python
    # [LLM call and cost log remain exactly as in 4.4 — no changes here]
    # ...
    verdict_type, matched_metric_name, _reasoning = _parse_full_verdict_response(response.content)

    if verdict_type not in {"DELIVERED", "MISSED", "INSUFFICIENT_DATA"}:
        logger.warning(
            "LLM returned invalid verdict — defaulting to INSUFFICIENT_DATA",
            extra={"ticker": ticker, "actuals_quarter": actuals_quarter, "jobId": job_id},
        )
        verdict_type = "INSUFFICIENT_DATA"

    _traces.append({
        "tool_call": {
            "action": "llm_verdict",
            "claim_metric": claim_metric,
            "target_value": target_value,
            "target_unit": target_unit,
            "model": response.model,
            "verdict": verdict_type,
            "matched_metric": matched_metric_name,
        },
        "result_summary": (
            f"LLM verdict: {verdict_type} "
            f"(matched: {matched_metric_name or 'none'}). {_reasoning}"
        ),
        "edgar_filing_ref": None,
    })
```

**Unit conflict path — append conflict trace BEFORE calling `_insufficient_data()`:**

```python
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
            _traces.append({
                "tool_call": {
                    "action": "unit_conflict",
                    "claim_metric": claim_metric,
                    "target_unit": target_unit,
                    "actual_unit": actual_unit,
                    "reason": f"Cannot normalize {target_unit!r} to {actual_unit!r}",
                },
                "result_summary": (
                    f"Unit conflict: target in {target_unit!r} is incompatible with "
                    f"actual in {actual_unit!r} — upgrading to INSUFFICIENT_DATA"
                ),
                "edgar_filing_ref": None,
            })
            return await _insufficient_data(
                claim_id=claim_id,
                reason=f"Unit conflict: cannot normalize {target_unit!r} to {actual_unit!r}",
                actuals_quarter=actuals_quarter,
                traces=_traces,
            )
```

**Unit normalization step (replaces Step 8 from 4.4 — now appended to `_traces` BEFORE `insert_verdict`):**

Remove the old `normalization_needed` flag and its Step 8 block entirely. Replace with:

```python
    # ── Step 5 (continued): Append normalization trace if units differed ──────
    if (
        delta is not None
        and target_unit
        and actual_unit
        and target_unit.lower() != actual_unit.lower()
    ):
        _traces.append({
            "tool_call": {
                "action": "unit_normalization",
                "claim_metric": claim_metric,
                "target_value": target_value,
                "target_unit": target_unit,
                "actual_value": actual_value,
                "actual_unit": actual_unit,
                "delta": delta,
            },
            "result_summary": (
                f"Normalized units before delta: "
                f"target={target_value} ({target_unit}), "
                f"actual={actual_value} ({actual_unit}), "
                f"delta={delta}"
            ),
            "edgar_filing_ref": None,
        })
```

**After `insert_verdict()` — flush ALL collected traces (replaces old Step 8):**

```python
    # ── Step 7: Persist verdict with delta and confidence ─────────────────────
    verdict_id = await insert_verdict(
        claim_id=claim_id,
        verdict_type=verdict_type,
        delta=delta,
        confidence_score=confidence_score,
    )

    # ── Step 8: Write all accumulated reasoning traces ────────────────────────
    for step_index, trace in enumerate(_traces, 1):
        await insert_reasoning_trace(
            verdict_id=verdict_id,
            step_index=step_index,
            tool_call=trace.get("tool_call"),
            result_summary=trace.get("result_summary"),
            edgar_filing_ref=trace.get("edgar_filing_ref"),
        )
```

### `test_verification.py` — Required Additions to 3 Early-Exit Tests

These 3 tests do NOT use `_patch_all()` and currently have no `insert_reasoning_trace` mock. After story 4.5, `_insufficient_data(traces=...)` will call `insert_reasoning_trace`. Add the mock to each:

**`test_insufficient_data_on_alignment_fetch_error`** — add to the `with (...)` block:
```python
patch("src.services.verification_service.insert_reasoning_trace", new=AsyncMock(return_value="trace-id-align-err")),
```

**`test_insufficient_data_on_filing_not_yet_available`** — add to the innermost `with` context:
```python
patch("src.services.verification_service.insert_reasoning_trace", new=AsyncMock(return_value="trace-id-nf")),
```

**`test_insufficient_data_on_financials_fetch_error`** — add to the `with (...)` block:
```python
patch("src.services.verification_service.insert_reasoning_trace", new=AsyncMock(return_value="trace-id-fe")),
```

No other changes to `test_verification.py`. The `_patch_all()` helper already mocks `insert_reasoning_trace` (added in story 4.4).

### `test_delta_scoring.py` — Assertion Updates

**`test_normalization_trace_written_when_units_differ`** — current assertion:
```python
mock_trace.assert_called_once()  # or similar exact-call-count assertion
```
Change to:
```python
# insert_reasoning_trace is called multiple times (alignment + financials + LLM + normalization)
# Assert at least one normalization-specific call was made
norm_calls = [
    call for call in mock_trace.call_args_list
    if call.kwargs.get("tool_call", {}).get("action") == "unit_normalization"
]
assert len(norm_calls) == 1, "Expected exactly one unit_normalization trace step"
norm_kwargs = norm_calls[0].kwargs
assert norm_kwargs["tool_call"]["action"] == "unit_normalization"
assert norm_kwargs["result_summary"] is not None
```

**`test_no_trace_when_same_units`** — current assertion:
```python
mock_trace.assert_not_called()
```
Change to:
```python
# Traces ARE written (alignment, financials, LLM steps) — but no normalization step
norm_calls = [
    call for call in mock_trace.call_args_list
    if call.kwargs.get("tool_call", {}).get("action") == "unit_normalization"
]
assert len(norm_calls) == 0, "No unit_normalization trace step expected when units match"
```

> **Critical:** The `_patch_delta()` helper in `test_delta_scoring.py` already patches `insert_reasoning_trace` — do NOT add a second patch. Just update the assertions in the two tests above.

### `test_reasoning_trace.py` — Key Test Patterns

**Shared imports and fixture helpers** (mirror the existing test_delta_scoring.py patterns):

```python
"""Tests for structured reasoning trace logging (story 4.5)."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, call, patch

import pytest

from src.core.llm.base import LLMResponse
from src.models.alignment_models import AlignmentDecision
from src.models.financials_models import FinancialMetric, FinancialsResult


# Reuse the same helper factories as test_verification.py and test_delta_scoring.py
# Copy _make_alignment, _make_financials, _make_llm_response from test_verification.py
```

**Patch helper for trace tests:**

```python
def _patch_trace(
    target_unit="billion USD",        # differs from actual "USD" → triggers normalization
    actual_metric_unit="USD",
    verdict="DELIVERED",
    alignment_status="ALIGNED",
    financials_status="SUCCESS",
):
    """Patch all external calls; return (ExitStack, mock_insert_reasoning_trace)."""
    from contextlib import ExitStack
    stack = ExitStack()
    mock_trace = AsyncMock(return_value="trace-uuid-rt")

    stack.enter_context(patch(
        "src.services.verification_service.align_call_to_actuals",
        new=AsyncMock(return_value=_make_alignment(status=alignment_status)),
    ))
    metric = FinancialMetric(
        ticker="AAPL", quarter="Q3-2024", metric_name="revenue",
        value="383000000000", unit=actual_metric_unit,
        section_reference="us-gaap/Revenue",
        filing_url="https://www.sec.gov/...",
        filing_type="10-Q", parse_status="SUCCESS",
    )
    stack.enter_context(patch(
        "src.services.verification_service.ingest_financial_actuals",
        new=AsyncMock(return_value=FinancialsResult(
            ticker="AAPL", quarter="Q3-2024", filing_type="10-Q",
            status=financials_status,
            metrics=[metric] if financials_status == "SUCCESS" else [],
            filing_url="https://www.sec.gov/..." if financials_status == "SUCCESS" else "",
        )),
    ))
    content = json.dumps({"verdict": verdict, "reasoning": "test", "matched_metric": "revenue"})
    mock_prov = MagicMock()
    mock_prov.complete = AsyncMock(return_value=LLMResponse(
        content=content, tool_calls=[], model="claude-sonnet-4-6",
        input_tokens=100, output_tokens=20,
    ))
    stack.enter_context(patch("src.core.llm.base._provider", mock_prov))
    stack.enter_context(patch(
        "src.services.verification_service.insert_verdict",
        new=AsyncMock(return_value="verdict-uuid-rt"),
    ))
    stack.enter_context(patch(
        "src.services.verification_service.insert_reasoning_trace",
        new=mock_trace,
    ))
    return stack, mock_trace
```

**Key test patterns:**

```python
CLAIM_KWARGS = {
    "claim_id": "claim-rt-123",
    "claim_quarter": "Q2-2024",
    "claim_metric": "revenue",
    "target_value": "380",
    "target_unit": "billion USD",   # differs from "USD" → triggers normalization
    "ticker": "AAPL",
    "job_id": "job-rt-test",
    "raw_quote": "We expect Q3 revenue of $380 billion",
    "timeframe": "Q3 2024",
}


@pytest.mark.asyncio
async def test_full_trace_steps_logged_on_delivered():
    """DELIVERED with different units → 4 steps: alignment, financials, LLM, normalization."""
    from src.services.verification_service import verify_claim

    with _patch_trace(target_unit="billion USD", actual_metric_unit="USD", verdict="DELIVERED")[0] as stack:
        # Need to unpack tuple from _patch_trace
        pass
    
    # Use context manager correctly:
    stack, mock_trace = _patch_trace(target_unit="billion USD", actual_metric_unit="USD", verdict="DELIVERED")
    with stack:
        await verify_claim(**CLAIM_KWARGS)

    assert mock_trace.call_count == 4
    step_indices = [c.kwargs["step_index"] for c in mock_trace.call_args_list]
    assert step_indices == [1, 2, 3, 4]


@pytest.mark.asyncio
async def test_full_trace_steps_same_units():
    """DELIVERED with matching units → 3 steps: no normalization."""
    from src.services.verification_service import verify_claim

    # Override target_unit to match actual
    kwargs = {**CLAIM_KWARGS, "target_unit": "USD", "target_value": "383000000000"}
    stack, mock_trace = _patch_trace(target_unit="USD", actual_metric_unit="USD", verdict="DELIVERED")
    with stack:
        await verify_claim(**kwargs)

    assert mock_trace.call_count == 3
    step_indices = [c.kwargs["step_index"] for c in mock_trace.call_args_list]
    assert step_indices == [1, 2, 3]


@pytest.mark.asyncio
async def test_alignment_failure_writes_one_trace_step():
    """Alignment FETCH_ERROR → 1 trace step (alignment itself)."""
    from src.services.verification_service import verify_claim

    failed_alignment = AlignmentDecision(
        ticker="AAPL", call_quarter="Q2-2024", actuals_quarter="Q3-2024",
        filing_type="10-Q", filing_url="",
        alignment_confidence="LOW",
        mapping_rationale="EDGAR fetch error for AAPL",
        status="FETCH_ERROR",
    )
    mock_trace = AsyncMock(return_value="trace-align-fail")
    with (
        patch("src.services.verification_service.align_call_to_actuals", new=AsyncMock(return_value=failed_alignment)),
        patch("src.services.verification_service.insert_verdict", new=AsyncMock(return_value="v-align-fail")),
        patch("src.services.verification_service.insert_reasoning_trace", new=mock_trace),
    ):
        result = await verify_claim(**CLAIM_KWARGS)

    assert result.verdict_type == "INSUFFICIENT_DATA"
    assert mock_trace.call_count == 1
    first_call = mock_trace.call_args_list[0].kwargs
    assert first_call["step_index"] == 1
    assert first_call["tool_call"]["action"] == "temporal_alignment"
    assert first_call["tool_call"]["status"] == "FETCH_ERROR"
```

**For `test_edgar_filing_ref_format_on_alignment_step`:**
```python
    first_call = mock_trace.call_args_list[0].kwargs
    assert first_call["step_index"] == 1
    ref = first_call["edgar_filing_ref"]
    # Format: "{filing_type} | {ticker} | {quarter} | {url}"
    assert ref is not None
    parts = ref.split(" | ")
    assert len(parts) == 4
    assert parts[0] == "10-Q"
    assert parts[1] == "AAPL"
    assert parts[2] == "Q3-2024"
    assert parts[3].startswith("https://")
```

**For `test_all_traces_share_same_verdict_id`:**
```python
    verdict_ids = {c.kwargs["verdict_id"] for c in mock_trace.call_args_list}
    assert len(verdict_ids) == 1, "All trace steps must share a single verdict_id"
    assert "verdict-uuid-rt" in verdict_ids
```

### Step Schema Reference

| Step | `action` | `edgar_filing_ref` | When present |
|------|----------|-------------------|--------------|
| 1 | `temporal_alignment` | `"{type} \| {ticker} \| {quarter} \| {url}"` or `None` | Always |
| 2 | `fetch_financial_actuals` | `"{type} \| {ticker} \| {quarter} \| {url}"` or `None` | When alignment succeeds |
| 3 | `llm_verdict` | `None` | When financials fetched |
| 4 | `unit_normalization` | `None` | When units differ (optional) |
| 4 | `unit_conflict` | `None` | When units incompatible (replaces step 4, INSUFFICIENT_DATA) |

For early-exit paths:
- Alignment failure → steps 1 only (action: `temporal_alignment`, status: `FETCH_ERROR`)
- Financials failure → steps 1–2 (step 2 shows `FETCH_ERROR` or `FILING_NOT_YET_AVAILABLE`)
- Unit conflict → steps 1–3 + step 4 (action: `unit_conflict`)

### Logger Name — Do Not Change

```python
logger = get_logger("ml-sidecar.verification_service")
```

Do NOT add `timestamp` to any `extra` dict — the formatter adds it automatically.

### Regression Guard: Existing Tests Must Stay Green

**`test_verification.py` (9 tests):**
- Tests using `_patch_all()`: unaffected — already mock `insert_reasoning_trace`
- 3 early-exit tests: add `insert_reasoning_trace` mock (Task 4 above)
- `test_llm_called_via_abstraction_only`: no DB calls, unaffected

**`test_delta_scoring.py` (10 tests):**
- `_patch_delta()` already mocks `insert_reasoning_trace` for all delta tests
- 2 tests need assertion-only updates (Tasks 5 above) — no structural changes

**Pre-existing failures unchanged:** `test_ingestion.py` (12, lxml missing), `test_yfinance_service.py` (6, yfinance missing).

### Architecture Guardrails

- `insert_reasoning_trace()` is called AFTER `insert_verdict()` — `verdict_id` must exist before any trace write
- Traces are written in `enumerate(traces, 1)` order — `step_index` is positional, not stored in the trace dict
- `_traces` is a plain `list[dict]` — no class needed; dict keys: `tool_call`, `result_summary`, `edgar_filing_ref`
- `edgar_filing_ref` is `None` when URL is absent — never an empty string in the DB
- Trace writes are not wrapped in a transaction — individual trace failures do not roll back the verdict (DB write failure is logged, not propagated to caller)
- `tool_call` dict is serialized to JSONB in `insert_reasoning_trace()` via `json.dumps()` — all values must be JSON-serializable primitives (str, int, float, None, list, dict)
- Never log: LLM prompt content, API keys, raw EDGAR response bodies, PII

### References

- [`ml-sidecar/src/services/verification_service.py`](ml-sidecar/src/services/verification_service.py) — file to refactor (current state is story 4.4 implementation)
- [`ml-sidecar/src/db/queries.py`](ml-sidecar/src/db/queries.py:146) — `insert_reasoning_trace()` (lines 146–170); signature stable
- [`api/src/db/schema.ts`](api/src/db/schema.ts:130) — `reasoning_traces` table definition (lines 130–145)
- [`ml-sidecar/tests/test_verification.py`](ml-sidecar/tests/test_verification.py) — 3 early-exit tests need `insert_reasoning_trace` mock
- [`ml-sidecar/tests/test_delta_scoring.py`](ml-sidecar/tests/test_delta_scoring.py) — 2 normalization assertions need updating
- [`ml-sidecar/src/models/alignment_models.py`](ml-sidecar/src/models/alignment_models.py) — `AlignmentDecision` fields (ticker, filing_type, filing_url, actuals_quarter, status, alignment_confidence, mapping_rationale)
- [`ml-sidecar/src/models/financials_models.py`](ml-sidecar/src/models/financials_models.py) — `FinancialsResult` fields (filing_type, status, metrics, filing_url)

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6 (story creation via bmad-create-story, 2026-06-07)

### Debug Log References

### Completion Notes List

### File List
