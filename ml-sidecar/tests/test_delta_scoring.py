"""Tests for delta calculation and confidence scoring (story 4.4)."""

from __future__ import annotations

import json
from contextlib import ExitStack
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.core.llm.base import LLMResponse
from src.models.alignment_models import AlignmentDecision
from src.models.financials_models import FinancialMetric, FinancialsResult

# ---------------------------------------------------------------------------
# Shared fixtures (mirrored from test_verification.py)
# ---------------------------------------------------------------------------

CLAIM_KWARGS = {
    "claim_id": "claim-delta-123",
    "claim_quarter": "Q2-2024",
    "claim_metric": "revenue",
    "target_value": "380",
    "target_unit": "billion USD",
    "ticker": "AAPL",
    "job_id": "test-job-delta",
    "raw_quote": "We expect Q3 revenue to be approximately $380 billion",
    "timeframe": "Q3 2024",
}


def _make_alignment() -> AlignmentDecision:
    return AlignmentDecision(
        ticker="AAPL",
        call_quarter="Q2-2024",
        actuals_quarter="Q3-2024",
        filing_type="10-Q",
        filing_url="https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/0000320193-24-000123-index.htm",
        alignment_confidence="HIGH",
        mapping_rationale="Calendar quarter succession: Q2-2024 → Q3-2024; 10-Q confirmed",
        status="ALIGNED",
    )


def _make_financials(
    value: str = "383000000000",
    unit: str = "USD",
    metric_name: str = "revenue",
    parse_status: str = "SUCCESS",
) -> FinancialsResult:
    metric = FinancialMetric(
        ticker="AAPL",
        quarter="Q3-2024",
        metric_name=metric_name,
        value=value,
        unit=unit,
        section_reference="us-gaap/Revenue",
        filing_url="https://www.sec.gov/...",
        filing_type="10-Q",
        parse_status=parse_status,
    )
    return FinancialsResult(
        ticker="AAPL",
        quarter="Q3-2024",
        filing_type="10-Q",
        status="SUCCESS",
        metrics=[metric],
        filing_url="https://www.sec.gov/...",
    )


def _make_llm_response(verdict: str = "DELIVERED", matched_metric: str = "revenue") -> LLMResponse:
    content = json.dumps({
        "verdict": verdict,
        "reasoning": "Values match",
        "matched_metric": matched_metric,
    })
    return LLMResponse(
        content=content,
        tool_calls=[],
        model="claude-sonnet-4-6",
        input_tokens=100,
        output_tokens=20,
    )


def _patch_delta(
    target_value: str = "383000000000",
    target_unit: str = "USD",
    actual_metric_value: str = "383000000000",
    actual_metric_unit: str = "USD",
    llm_matched_metric: str = "revenue",
    verdict: str = "DELIVERED",
    insert_verdict_mock: AsyncMock | None = None,
    insert_trace_mock: AsyncMock | None = None,
) -> ExitStack:
    """Return an ExitStack with all external calls patched."""
    llm_resp = _make_llm_response(verdict=verdict, matched_metric=llm_matched_metric)
    financials = _make_financials(
        value=actual_metric_value,
        unit=actual_metric_unit,
    )

    stack = ExitStack()
    # Override target in CLAIM_KWARGS via alignment; financials carries actual
    stack.enter_context(patch(
        "src.services.verification_service.align_call_to_actuals",
        new=AsyncMock(return_value=_make_alignment()),
    ))
    stack.enter_context(patch(
        "src.services.verification_service.ingest_financial_actuals",
        new=AsyncMock(return_value=financials),
    ))
    mock_prov = MagicMock()
    mock_prov.complete = AsyncMock(return_value=llm_resp)
    stack.enter_context(patch("src.core.llm.base._provider", mock_prov))
    stack.enter_context(patch(
        "src.services.verification_service.insert_verdict",
        new=insert_verdict_mock or AsyncMock(return_value="verdict-uuid-delta"),
    ))
    stack.enter_context(patch(
        "src.services.verification_service.insert_reasoning_trace",
        new=insert_trace_mock or AsyncMock(return_value="trace-uuid-delta"),
    ))
    return stack


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_delta_calculated_for_delivered():
    """DELIVERED verdict: insert_verdict receives non-None delta and confidence_score."""
    from src.services.verification_service import verify_claim

    mock_insert = AsyncMock(return_value="verdict-uuid-delta")
    kwargs = {**CLAIM_KWARGS, "target_value": "383000000000", "target_unit": "USD"}

    with _patch_delta(
        target_value="383000000000",
        target_unit="USD",
        actual_metric_value="383000000000",
        actual_metric_unit="USD",
        insert_verdict_mock=mock_insert,
    ):
        result = await verify_claim(**kwargs)

    call_kwargs = mock_insert.call_args.kwargs
    assert call_kwargs["delta"] is not None
    assert call_kwargs["confidence_score"] is not None
    assert result.delta is not None
    assert result.confidence_score is not None


@pytest.mark.asyncio
async def test_delta_null_for_insufficient_data():
    """INSUFFICIENT_DATA verdict: insert_verdict receives delta=None."""
    from src.services.verification_service import verify_claim

    mock_insert = AsyncMock(return_value="verdict-uuid-delta")

    with _patch_delta(
        verdict="INSUFFICIENT_DATA",
        insert_verdict_mock=mock_insert,
    ):
        result = await verify_claim(**CLAIM_KWARGS)

    call_kwargs = mock_insert.call_args.kwargs
    assert call_kwargs["delta"] is None
    assert result.delta is None


@pytest.mark.asyncio
async def test_unit_normalization_billion_to_raw():
    """target '380' 'billion USD' + actual '383000000000' 'USD' → delta ≈ 3e9."""
    from src.services.verification_service import verify_claim

    mock_insert = AsyncMock(return_value="verdict-uuid-delta")

    with _patch_delta(
        actual_metric_value="383000000000",
        actual_metric_unit="USD",
        insert_verdict_mock=mock_insert,
    ):
        # CLAIM_KWARGS has target_value="380", target_unit="billion USD"
        result = await verify_claim(**CLAIM_KWARGS)

    call_kwargs = mock_insert.call_args.kwargs
    delta_val = float(call_kwargs["delta"])
    assert abs(delta_val - 3_000_000_000.0) < 1.0, f"Expected ~3e9, got {delta_val}"
    assert result.delta is not None
    assert abs(float(result.delta) - 3_000_000_000.0) < 1.0


@pytest.mark.asyncio
async def test_unit_conflict_produces_insufficient_data():
    """Incompatible units (billion USD vs percent) → INSUFFICIENT_DATA."""
    from src.services.verification_service import verify_claim

    mock_insert = AsyncMock(return_value="verdict-uuid-delta")

    with _patch_delta(
        actual_metric_value="45",
        actual_metric_unit="percent",
        insert_verdict_mock=mock_insert,
    ):
        # CLAIM_KWARGS has target_unit="billion USD" — conflicts with "percent"
        result = await verify_claim(**CLAIM_KWARGS)

    assert result.verdict_type == "INSUFFICIENT_DATA"
    call_kwargs = mock_insert.call_args.kwargs
    assert call_kwargs.get("delta") is None


@pytest.mark.asyncio
async def test_confidence_high_for_clear_match():
    """Direct metric name match + SUCCESS parse → confidence_score >= 0.80."""
    from src.services.verification_service import verify_claim

    mock_insert = AsyncMock(return_value="verdict-uuid-delta")
    kwargs = {**CLAIM_KWARGS, "target_value": "383000000000", "target_unit": "USD"}

    with _patch_delta(
        target_value="383000000000",
        target_unit="USD",
        actual_metric_value="383000000000",
        actual_metric_unit="USD",
        llm_matched_metric="revenue",
        insert_verdict_mock=mock_insert,
    ):
        result = await verify_claim(**kwargs)

    call_kwargs = mock_insert.call_args.kwargs
    assert call_kwargs["confidence_score"] >= Decimal("0.80"), (
        f"Expected high confidence, got {call_kwargs['confidence_score']}"
    )
    assert result.confidence_score >= 0.80


@pytest.mark.asyncio
async def test_confidence_medium_for_inferred_match():
    """LLM matched_metric is a different name → 0.40 <= confidence_score < 0.80."""
    from src.services.verification_service import verify_claim

    mock_insert = AsyncMock(return_value="verdict-uuid-delta")
    # Use a financials with a metric named "totalRevenue" so LLM-matched name differs from claim_metric
    financials = _make_financials(metric_name="totalRevenue", value="383000000000", unit="USD")
    llm_resp = _make_llm_response(verdict="DELIVERED", matched_metric="totalRevenue")

    mock_prov = MagicMock()
    mock_prov.complete = AsyncMock(return_value=llm_resp)

    kwargs = {**CLAIM_KWARGS, "claim_metric": "operating income", "target_value": "383000000000", "target_unit": "USD"}

    with (
        patch("src.services.verification_service.align_call_to_actuals",
              new=AsyncMock(return_value=_make_alignment())),
        patch("src.services.verification_service.ingest_financial_actuals",
              new=AsyncMock(return_value=financials)),
        patch("src.core.llm.base._provider", mock_prov),
        patch("src.services.verification_service.insert_verdict", new=mock_insert),
        patch("src.services.verification_service.insert_reasoning_trace",
              new=AsyncMock(return_value="trace-uuid")),
    ):
        result = await verify_claim(**kwargs)

    call_kwargs = mock_insert.call_args.kwargs
    score = call_kwargs["confidence_score"]
    assert Decimal("0.40") <= score < Decimal("0.80"), (
        f"Expected medium confidence (0.40–0.79), got {score}"
    )
    assert 0.40 <= result.confidence_score < 0.80


@pytest.mark.asyncio
async def test_confidence_low_for_insufficient_data():
    """INSUFFICIENT_DATA verdict → confidence_score <= 0.30."""
    from src.services.verification_service import verify_claim

    mock_insert = AsyncMock(return_value="verdict-uuid-delta")

    with _patch_delta(
        verdict="INSUFFICIENT_DATA",
        insert_verdict_mock=mock_insert,
    ):
        result = await verify_claim(**CLAIM_KWARGS)

    call_kwargs = mock_insert.call_args.kwargs
    assert call_kwargs["confidence_score"] <= Decimal("0.30"), (
        f"Expected low confidence, got {call_kwargs['confidence_score']}"
    )
    assert result.confidence_score <= 0.30


@pytest.mark.asyncio
async def test_low_confidence_verdict_still_written():
    """Low-confidence verdicts must still call insert_verdict (never suppressed)."""
    from src.services.verification_service import verify_claim

    mock_insert = AsyncMock(return_value="verdict-uuid-delta")

    with _patch_delta(
        verdict="INSUFFICIENT_DATA",
        insert_verdict_mock=mock_insert,
    ):
        result = await verify_claim(**CLAIM_KWARGS)

    mock_insert.assert_called_once()
    assert result.verdict_type == "INSUFFICIENT_DATA"


@pytest.mark.asyncio
async def test_normalization_trace_written_when_units_differ():
    """target_unit='billion USD', actual unit='USD' → insert_reasoning_trace called with result_summary."""
    from src.services.verification_service import verify_claim

    mock_trace = AsyncMock(return_value="trace-uuid-delta")

    with _patch_delta(
        actual_metric_value="383000000000",
        actual_metric_unit="USD",
        insert_trace_mock=mock_trace,
    ):
        # CLAIM_KWARGS has target_unit="billion USD" — differs from "USD"
        await verify_claim(**CLAIM_KWARGS)

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


@pytest.mark.asyncio
async def test_no_trace_when_same_units():
    """Same units on both sides → insert_reasoning_trace NOT called."""
    from src.services.verification_service import verify_claim

    mock_trace = AsyncMock(return_value="trace-uuid-delta")
    kwargs = {**CLAIM_KWARGS, "target_value": "383000000000", "target_unit": "USD"}

    with _patch_delta(
        actual_metric_value="383000000000",
        actual_metric_unit="USD",
        insert_trace_mock=mock_trace,
    ):
        await verify_claim(**kwargs)

    # Traces ARE written (alignment, financials, LLM steps) — but no normalization step
    norm_calls = [
        call for call in mock_trace.call_args_list
        if call.kwargs.get("tool_call", {}).get("action") == "unit_normalization"
    ]
    assert len(norm_calls) == 0, "No unit_normalization trace step expected when units match"
