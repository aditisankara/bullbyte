"""Tests for structured reasoning trace logging (story 4.5)."""

from __future__ import annotations

import json
from contextlib import ExitStack
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.core.llm.base import LLMResponse
from src.models.alignment_models import AlignmentDecision
from src.models.financials_models import FinancialMetric, FinancialsResult

# ---------------------------------------------------------------------------
# Fixtures (mirrors test_verification.py)
# ---------------------------------------------------------------------------

CLAIM_KWARGS = {
    "claim_id": "claim-rt-123",
    "claim_quarter": "Q2-2024",
    "claim_metric": "revenue",
    "target_value": "380",
    "target_unit": "billion USD",
    "ticker": "AAPL",
    "job_id": "job-rt-test",
    "raw_quote": "We expect Q3 revenue of $380 billion",
    "timeframe": "Q3 2024",
}


def _make_alignment(status: str = "ALIGNED") -> AlignmentDecision:
    return AlignmentDecision(
        ticker="AAPL",
        call_quarter="Q2-2024",
        actuals_quarter="Q3-2024",
        filing_type="10-Q",
        filing_url="https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/0000320193-24-000123-index.htm",
        alignment_confidence="HIGH",
        mapping_rationale="Calendar quarter succession: Q2-2024 → Q3-2024; 10-Q confirmed",
        status=status,
    )


def _make_financials(
    status: str = "SUCCESS",
    unit: str = "USD",
    filing_url: str = "https://www.sec.gov/...",
) -> FinancialsResult:
    metrics = []
    if status == "SUCCESS":
        metrics = [
            FinancialMetric(
                ticker="AAPL",
                quarter="Q3-2024",
                metric_name="revenue",
                value="383000000000",
                unit=unit,
                section_reference="us-gaap/Revenue",
                filing_url=filing_url,
                filing_type="10-Q",
                parse_status="SUCCESS",
            )
        ]
    return FinancialsResult(
        ticker="AAPL",
        quarter="Q3-2024",
        filing_type="10-Q",
        status=status,
        metrics=metrics,
        filing_url=filing_url if status == "SUCCESS" else "",
    )


def _make_llm_response(verdict: str = "DELIVERED") -> LLMResponse:
    content = json.dumps({
        "verdict": verdict,
        "reasoning": "Revenue matched target",
        "matched_metric": "revenue",
    })
    return LLMResponse(
        content=content,
        tool_calls=[],
        model="claude-sonnet-4-6",
        input_tokens=100,
        output_tokens=20,
    )


def _patch_trace(
    target_unit: str = "billion USD",
    actual_metric_unit: str = "USD",
    verdict: str = "DELIVERED",
    alignment_status: str = "ALIGNED",
    financials_status: str = "SUCCESS",
) -> tuple[ExitStack, AsyncMock]:
    """Patch all external calls; return (ExitStack, mock_insert_reasoning_trace)."""
    stack = ExitStack()
    mock_trace = AsyncMock(return_value="trace-uuid-rt")

    stack.enter_context(patch(
        "src.services.verification_service.align_call_to_actuals",
        new=AsyncMock(return_value=_make_alignment(status=alignment_status)),
    ))
    stack.enter_context(patch(
        "src.services.verification_service.ingest_financial_actuals",
        new=AsyncMock(return_value=_make_financials(
            status=financials_status, unit=actual_metric_unit,
        )),
    ))
    mock_prov = MagicMock()
    mock_prov.complete = AsyncMock(return_value=_make_llm_response(verdict=verdict))
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


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_full_trace_steps_logged_on_delivered():
    """DELIVERED with different units → 4 steps: alignment, financials, LLM, normalization."""
    from src.services.verification_service import verify_claim

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

    kwargs = {**CLAIM_KWARGS, "target_unit": "USD", "target_value": "383000000000"}
    stack, mock_trace = _patch_trace(target_unit="USD", actual_metric_unit="USD", verdict="DELIVERED")
    with stack:
        await verify_claim(**kwargs)

    assert mock_trace.call_count == 3
    step_indices = [c.kwargs["step_index"] for c in mock_trace.call_args_list]
    assert step_indices == [1, 2, 3]


@pytest.mark.asyncio
async def test_alignment_failure_writes_one_trace_step():
    """Alignment FETCH_ERROR → 1 trace step with action temporal_alignment."""
    from src.services.verification_service import verify_claim

    failed_alignment = AlignmentDecision(
        ticker="AAPL",
        call_quarter="Q2-2024",
        actuals_quarter="Q3-2024",
        filing_type="10-Q",
        filing_url="",
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


@pytest.mark.asyncio
async def test_financials_failure_writes_two_trace_steps():
    """SUCCESS alignment, FETCH_ERROR financials → 2 trace steps."""
    from src.services.verification_service import verify_claim

    mock_trace = AsyncMock(return_value="trace-fin-fail")
    with (
        patch("src.services.verification_service.align_call_to_actuals",
              new=AsyncMock(return_value=_make_alignment())),
        patch("src.services.verification_service.ingest_financial_actuals",
              new=AsyncMock(return_value=_make_financials(status="FETCH_ERROR"))),
        patch("src.services.verification_service.insert_verdict",
              new=AsyncMock(return_value="v-fin-fail")),
        patch("src.services.verification_service.insert_reasoning_trace", new=mock_trace),
    ):
        result = await verify_claim(**CLAIM_KWARGS)

    assert result.verdict_type == "INSUFFICIENT_DATA"
    assert mock_trace.call_count == 2
    actions = [c.kwargs["tool_call"]["action"] for c in mock_trace.call_args_list]
    assert actions == ["temporal_alignment", "fetch_financial_actuals"]


@pytest.mark.asyncio
async def test_unit_conflict_writes_traces_including_conflict_step():
    """Unit conflict (billion USD vs percent) → 4 steps including unit_conflict."""
    from src.services.verification_service import verify_claim

    # percent metric will conflict with "billion USD" target
    financials = FinancialsResult(
        ticker="AAPL",
        quarter="Q3-2024",
        filing_type="10-Q",
        status="SUCCESS",
        metrics=[
            FinancialMetric(
                ticker="AAPL",
                quarter="Q3-2024",
                metric_name="revenue",
                value="45",
                unit="percent",
                section_reference="us-gaap/Revenue",
                filing_url="https://www.sec.gov/...",
                filing_type="10-Q",
                parse_status="SUCCESS",
            )
        ],
        filing_url="https://www.sec.gov/...",
    )
    mock_trace = AsyncMock(return_value="trace-conflict")
    mock_prov = MagicMock()
    mock_prov.complete = AsyncMock(return_value=_make_llm_response("DELIVERED"))
    with (
        patch("src.services.verification_service.align_call_to_actuals",
              new=AsyncMock(return_value=_make_alignment())),
        patch("src.services.verification_service.ingest_financial_actuals",
              new=AsyncMock(return_value=financials)),
        patch("src.core.llm.base._provider", mock_prov),
        patch("src.services.verification_service.insert_verdict",
              new=AsyncMock(return_value="v-conflict")),
        patch("src.services.verification_service.insert_reasoning_trace", new=mock_trace),
    ):
        result = await verify_claim(**CLAIM_KWARGS)

    assert result.verdict_type == "INSUFFICIENT_DATA"
    assert mock_trace.call_count == 4
    actions = [c.kwargs["tool_call"]["action"] for c in mock_trace.call_args_list]
    assert "unit_conflict" in actions


@pytest.mark.asyncio
async def test_edgar_filing_ref_format_on_alignment_step():
    """Alignment step edgar_filing_ref matches '{filing_type} | {ticker} | {quarter} | {url}'."""
    from src.services.verification_service import verify_claim

    stack, mock_trace = _patch_trace(verdict="DELIVERED")
    with stack:
        await verify_claim(**CLAIM_KWARGS)

    first_call = mock_trace.call_args_list[0].kwargs
    assert first_call["step_index"] == 1
    ref = first_call["edgar_filing_ref"]
    assert ref is not None
    parts = ref.split(" | ")
    assert len(parts) == 4
    assert parts[0] == "10-Q"
    assert parts[1] == "AAPL"
    assert parts[2] == "Q3-2024"
    assert parts[3].startswith("https://")


@pytest.mark.asyncio
async def test_edgar_filing_ref_none_on_llm_step():
    """LLM verdict step always has edgar_filing_ref=None."""
    from src.services.verification_service import verify_claim

    stack, mock_trace = _patch_trace(verdict="DELIVERED")
    with stack:
        await verify_claim(**CLAIM_KWARGS)

    llm_calls = [
        c for c in mock_trace.call_args_list
        if c.kwargs.get("tool_call", {}).get("action") == "llm_verdict"
    ]
    assert len(llm_calls) == 1
    assert llm_calls[0].kwargs["edgar_filing_ref"] is None


@pytest.mark.asyncio
async def test_step_indices_sequential_from_1():
    """All step_index values passed to insert_reasoning_trace are 1, 2, 3, ... with no gaps."""
    from src.services.verification_service import verify_claim

    stack, mock_trace = _patch_trace(target_unit="billion USD", actual_metric_unit="USD", verdict="DELIVERED")
    with stack:
        await verify_claim(**CLAIM_KWARGS)

    step_indices = [c.kwargs["step_index"] for c in mock_trace.call_args_list]
    assert step_indices == list(range(1, len(step_indices) + 1))


@pytest.mark.asyncio
async def test_all_traces_share_same_verdict_id():
    """All insert_reasoning_trace calls use the same verdict_id."""
    from src.services.verification_service import verify_claim

    stack, mock_trace = _patch_trace(verdict="DELIVERED")
    with stack:
        await verify_claim(**CLAIM_KWARGS)

    verdict_ids = {c.kwargs["verdict_id"] for c in mock_trace.call_args_list}
    assert len(verdict_ids) == 1, "All trace steps must share a single verdict_id"
    assert "verdict-uuid-rt" in verdict_ids
