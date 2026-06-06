"""Tests for safe-harbour filtering and extraction confidence scoring (story 4.2)."""

from __future__ import annotations

import ast
import inspect
import json
import logging
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.core.llm.base import LLMResponse, reset_provider
from src.models.claim_models import ExtractionResult

from tests.test_extraction import TRANSCRIPT_FIXTURE, _make_mock_provider


@pytest.fixture(autouse=True)
def _reset_llm_provider():
    reset_provider()
    yield
    reset_provider()


# ---------------------------------------------------------------------------
# AC2 — high confidence for clearly stated claims
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_clear_claim_receives_high_confidence():
    response_json = json.dumps({
        "claims": [
            {
                "raw_quote": "We expect revenue of $380M in Q3",
                "claim_type": "revenue",
                "metric": "Q3 revenue",
                "target_value": "380",
                "target_unit": "million USD",
                "timeframe": "Q3 2024",
                "speaker": "CEO",
                "quarter": "Q2-2024",
                "extraction_confidence": 0.90,
            }
        ],
        "boilerplate": [],
    })
    mock_provider = _make_mock_provider(response_json)

    with patch("src.core.llm.base._provider", mock_provider):
        from src.services.extraction_service import extract_claims

        result = await extract_claims(
            transcript_text=TRANSCRIPT_FIXTURE,
            ticker="AAPL",
            quarter="Q2-2024",
            job_id="test-job-high-conf",
        )

    assert len(result.claims) == 1
    assert result.claims[0].extraction_confidence >= Decimal("0.80")


# ---------------------------------------------------------------------------
# AC3 — low confidence for hedged claims
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_hedged_claim_receives_low_confidence():
    response_json = json.dumps({
        "claims": [
            {
                "raw_quote": "We think revenue could be somewhere around $380M",
                "claim_type": "revenue",
                "metric": "Q3 revenue",
                "target_value": "380",
                "target_unit": "million USD",
                "timeframe": "Q3 2024",
                "speaker": "CEO",
                "quarter": "Q2-2024",
                "extraction_confidence": 0.45,
            }
        ],
        "boilerplate": [],
    })
    mock_provider = _make_mock_provider(response_json)

    with patch("src.core.llm.base._provider", mock_provider):
        from src.services.extraction_service import extract_claims

        result = await extract_claims(
            transcript_text=TRANSCRIPT_FIXTURE,
            ticker="AAPL",
            quarter="Q2-2024",
            job_id="test-job-low-conf",
        )

    assert len(result.claims) == 1
    assert result.claims[0].extraction_confidence < Decimal("0.60")


# ---------------------------------------------------------------------------
# AC1 — boilerplate filtered and logged at WARNING
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_boilerplate_filtered_and_logged(caplog):
    response_json = json.dumps({
        "claims": [],
        "boilerplate": [
            {
                "raw_segment": "These forward-looking statements involve risks and uncertainties that could cause actual results to differ materially from those projected.",
                "reason": "safe_harbour_boilerplate",
            }
        ],
    })
    mock_provider = _make_mock_provider(response_json)

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

    boilerplate_records = [
        r for r in caplog.records if "Safe-harbour boilerplate filtered" in r.getMessage()
    ]
    assert len(boilerplate_records) == 1


# ---------------------------------------------------------------------------
# AC4 — out-of-range confidence produces ExtractionError, not a persisted claim
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_confidence_out_of_range_produces_error():
    response_json = json.dumps({
        "claims": [
            {
                "raw_quote": "We expect revenue of $380M in Q3",
                "claim_type": "revenue",
                "metric": "Q3 revenue",
                "target_value": "380",
                "target_unit": "million USD",
                "timeframe": "Q3 2024",
                "speaker": "CEO",
                "quarter": "Q2-2024",
                "extraction_confidence": 1.5,  # out of range
            }
        ],
        "boilerplate": [],
    })
    mock_provider = _make_mock_provider(response_json)

    with patch("src.core.llm.base._provider", mock_provider):
        from src.services.extraction_service import extract_claims

        result = await extract_claims(
            transcript_text=TRANSCRIPT_FIXTURE,
            ticker="AAPL",
            quarter="Q2-2024",
            job_id="test-job-out-of-range",
        )

    assert len(result.claims) == 0
    assert len(result.errors) == 1
    assert "Claim validation failed" in result.errors[0].error_reason


# ---------------------------------------------------------------------------
# AC4 — analysis_router uses real confidence, not the 0.5 stub
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_null_boilerplate_field_does_not_crash():
    """LLM returning `"boilerplate": null` must not raise TypeError — treated as empty."""
    response_json = '{"claims": [], "boilerplate": null}'
    mock_provider = _make_mock_provider(response_json)

    with patch("src.core.llm.base._provider", mock_provider):
        from src.services.extraction_service import extract_claims

        result = await extract_claims(
            transcript_text=TRANSCRIPT_FIXTURE,
            ticker="AAPL",
            quarter="Q2-2024",
            job_id="test-job-null-boilerplate",
        )

    assert len(result.claims) == 0
    assert len(result.boilerplate_segments) == 0
    assert len(result.errors) == 0


@pytest.mark.asyncio
async def test_malformatted_quarter_uses_caller_fallback():
    """LLM returning a non-empty but badly formatted quarter triggers the caller-supplied fallback."""
    import json as _json

    response_json = _json.dumps({
        "claims": [
            {
                "raw_quote": "We expect revenue of $380M in Q3",
                "claim_type": "revenue",
                "metric": "Q3 revenue",
                "target_value": "380",
                "target_unit": "million USD",
                "timeframe": "Q3 2024",
                "speaker": "CEO",
                "quarter": "Q2 2024",  # space instead of dash — invalid format
                "extraction_confidence": 0.85,
            }
        ],
        "boilerplate": [],
    })
    mock_provider = _make_mock_provider(response_json)

    with patch("src.core.llm.base._provider", mock_provider):
        from src.services.extraction_service import extract_claims

        result = await extract_claims(
            transcript_text=TRANSCRIPT_FIXTURE,
            ticker="AAPL",
            quarter="Q2-2024",
            job_id="test-job-bad-quarter",
        )

    # Claim should be rescued with the caller-supplied quarter, not dropped
    assert len(result.claims) == 1
    assert result.claims[0].quarter == "Q2-2024"
    assert len(result.errors) == 0


def test_analysis_router_uses_real_confidence():
    import src.routers.analysis_router as router_module

    source = inspect.getsource(router_module)
    tree = ast.parse(source)

    # Verify the stub literal Decimal("0.5") is absent from the source
    assert 'Decimal("0.5")' not in source, (
        "analysis_router still contains hardcoded Decimal('0.5') stub — "
        "replace with Decimal(str(claim.extraction_confidence))"
    )
