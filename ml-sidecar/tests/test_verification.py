"""Tests for verification_service.verify_claim() (story 4.3)."""

from __future__ import annotations

import inspect
import json
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.core.llm.base import LLMResponse
from src.models.alignment_models import AlignmentDecision
from src.models.financials_models import FinancialMetric, FinancialsResult
from src.models.verdict_models import VerificationResult

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

CLAIM_KWARGS = {
    "claim_id": "claim-uuid-123",
    "claim_quarter": "Q2-2024",
    "claim_metric": "revenue",
    "target_value": "380",
    "target_unit": "billion USD",
    "ticker": "AAPL",
    "job_id": "test-job-verify",
    "raw_quote": "We expect Q3 revenue to be approximately $380 billion",
    "timeframe": "Q3 2024",
}


def _make_alignment(status: str = "ALIGNED", actuals_quarter: str = "Q3-2024") -> AlignmentDecision:
    return AlignmentDecision(
        ticker="AAPL",
        call_quarter="Q2-2024",
        actuals_quarter=actuals_quarter,
        filing_type="10-Q",
        filing_url="https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/0000320193-24-000123-index.htm",
        alignment_confidence="HIGH",
        mapping_rationale="Calendar quarter succession: Q2-2024 → Q3-2024; 10-Q confirmed",
        status=status,
    )


def _make_financials(
    status: str = "SUCCESS",
    metrics: list[FinancialMetric] | None = None,
) -> FinancialsResult:
    if metrics is None:
        metrics = [
            FinancialMetric(
                ticker="AAPL",
                quarter="Q3-2024",
                metric_name="revenue",
                value="383000000000",
                unit="USD",
                section_reference="us-gaap/RevenueFromContractWithCustomerExcludingAssessedTax",
                filing_url="https://www.sec.gov/...",
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
        filing_url="https://www.sec.gov/...",
    )


def _make_llm_response(verdict: str = "DELIVERED") -> LLMResponse:
    content = json.dumps({
        "verdict": verdict,
        "reasoning": "Revenue of $383B exceeded the $380B target",
        "matched_metric": "revenue",
    })
    return LLMResponse(
        content=content,
        tool_calls=[],
        model="claude-sonnet-4-6",
        input_tokens=200,
        output_tokens=30,
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _patch_all(
    alignment: AlignmentDecision | None = None,
    financials: FinancialsResult | None = None,
    llm_response: LLMResponse | None = None,
    insert_verdict_return: str = "verdict-uuid-456",
):
    """Return a context manager stack patching the three service dependencies."""
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


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_delivered_verdict():
    from src.services.verification_service import verify_claim

    with _patch_all(llm_response=_make_llm_response("DELIVERED")):
        result = await verify_claim(**CLAIM_KWARGS)

    assert isinstance(result, VerificationResult)
    assert result.verdict_type == "DELIVERED"
    assert result.claim_id == "claim-uuid-123"
    assert result.verdict_id == "verdict-uuid-456"
    assert result.actuals_quarter == "Q3-2024"


@pytest.mark.asyncio
async def test_missed_verdict():
    from src.services.verification_service import verify_claim

    with _patch_all(llm_response=_make_llm_response("MISSED")):
        result = await verify_claim(**CLAIM_KWARGS)

    assert result.verdict_type == "MISSED"


@pytest.mark.asyncio
async def test_insufficient_data_on_alignment_fetch_error():
    from src.services.verification_service import verify_claim

    failed_alignment = _make_alignment(status="FETCH_ERROR", actuals_quarter="Q3-2024")
    failed_alignment = AlignmentDecision(
        ticker="AAPL",
        call_quarter="Q2-2024",
        actuals_quarter="Q3-2024",
        filing_type="10-Q",
        filing_url="",
        alignment_confidence="LOW",
        mapping_rationale="EDGAR fetch error for AAPL Q3-2024 10-Q",
        status="FETCH_ERROR",
    )

    mock_financials = AsyncMock()
    mock_llm = MagicMock()

    with (
        patch("src.services.verification_service.align_call_to_actuals", new=AsyncMock(return_value=failed_alignment)),
        patch("src.services.verification_service.ingest_financial_actuals", new=mock_financials),
        patch("src.core.llm.base._provider", mock_llm),
        patch("src.services.verification_service.insert_verdict", new=AsyncMock(return_value="verdict-id-err")),
    ):
        result = await verify_claim(**CLAIM_KWARGS)

    assert result.verdict_type == "INSUFFICIENT_DATA"
    # LLM and financials must NOT be called when alignment fails
    mock_financials.assert_not_called()
    mock_llm.complete.assert_not_called()


@pytest.mark.asyncio
async def test_insufficient_data_on_filing_not_yet_available():
    from src.services.verification_service import verify_claim

    with _patch_all(
        financials=_make_financials(status="FILING_NOT_YET_AVAILABLE", metrics=[]),
    ):
        with patch("src.core.llm.base._provider") as mock_prov:
            with patch("src.services.verification_service.ingest_financial_actuals",
                       new=AsyncMock(return_value=_make_financials(status="FILING_NOT_YET_AVAILABLE", metrics=[]))):
                with patch("src.services.verification_service.align_call_to_actuals",
                           new=AsyncMock(return_value=_make_alignment())):
                    with patch("src.services.verification_service.insert_verdict",
                               new=AsyncMock(return_value="verdict-id-nf")):
                        result = await verify_claim(**CLAIM_KWARGS)

    assert result.verdict_type == "INSUFFICIENT_DATA"
    mock_prov.complete.assert_not_called()


@pytest.mark.asyncio
async def test_insufficient_data_on_financials_fetch_error():
    from src.services.verification_service import verify_claim

    with (
        patch("src.services.verification_service.align_call_to_actuals",
              new=AsyncMock(return_value=_make_alignment())),
        patch("src.services.verification_service.ingest_financial_actuals",
              new=AsyncMock(return_value=_make_financials(status="FETCH_ERROR", metrics=[]))),
        patch("src.services.verification_service.insert_verdict",
              new=AsyncMock(return_value="verdict-id-fe")),
    ):
        result = await verify_claim(**CLAIM_KWARGS)

    assert result.verdict_type == "INSUFFICIENT_DATA"


@pytest.mark.asyncio
async def test_insufficient_data_on_llm_parse_failure():
    from src.services.verification_service import verify_claim

    bad_response = LLMResponse(
        content="this is not valid json at all",
        tool_calls=[],
        model="claude-sonnet-4-6",
        input_tokens=10,
        output_tokens=5,
    )

    with _patch_all(llm_response=bad_response):
        result = await verify_claim(**CLAIM_KWARGS)

    assert result.verdict_type == "INSUFFICIENT_DATA"


@pytest.mark.asyncio
async def test_llm_cost_logged(caplog):
    import logging
    from src.services.verification_service import verify_claim

    with _patch_all():
        with caplog.at_level(logging.INFO, logger="ml-sidecar.verification_service"):
            result = await verify_claim(**CLAIM_KWARGS)

    cost_records = [r for r in caplog.records if "LLM call completed" in r.getMessage()]
    assert len(cost_records) == 1
    rec = cost_records[0]
    assert hasattr(rec, "model")
    assert hasattr(rec, "tokens_used")
    assert hasattr(rec, "estimated_cost_usd")
    assert hasattr(rec, "ticker")
    assert hasattr(rec, "jobId")
    assert result.verdict_type in {"DELIVERED", "MISSED", "INSUFFICIENT_DATA"}


@pytest.mark.asyncio
async def test_verdict_stored_screaming_snake_case():
    from src.services.verification_service import verify_claim

    mock_insert = AsyncMock(return_value="verdict-uuid-screaming")

    with (
        patch("src.services.verification_service.align_call_to_actuals",
              new=AsyncMock(return_value=_make_alignment())),
        patch("src.services.verification_service.ingest_financial_actuals",
              new=AsyncMock(return_value=_make_financials())),
        patch("src.core.llm.base._provider", MagicMock(complete=AsyncMock(return_value=_make_llm_response("DELIVERED")))),
        patch("src.services.verification_service.insert_verdict", new=mock_insert),
        patch("src.services.verification_service.insert_reasoning_trace",
              new=AsyncMock(return_value="trace-uuid-mock")),
    ):
        result = await verify_claim(**CLAIM_KWARGS)

    mock_insert.assert_called_once()
    call_kwargs = mock_insert.call_args.kwargs
    assert call_kwargs["verdict_type"] == "DELIVERED"
    # SCREAMING_SNAKE_CASE: all uppercase, no lowercase letters
    assert call_kwargs["verdict_type"] == call_kwargs["verdict_type"].upper()


def test_llm_called_via_abstraction_only():
    """verification_service.py must not import anthropic or openai directly (NFR17)."""
    import src.services.verification_service as mod

    source = inspect.getsource(mod)
    assert "import anthropic" not in source, "Direct anthropic import found in verification_service.py"
    assert "import openai" not in source, "Direct openai import found in verification_service.py"
    assert "from anthropic" not in source, "Direct anthropic import found in verification_service.py"
    assert "from openai" not in source, "Direct openai import found in verification_service.py"
