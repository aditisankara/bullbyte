"""Tests for the LLM-based claim extraction service (story 4.1)."""

from __future__ import annotations

import importlib
import sys
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.core.llm.base import LLMResponse, reset_provider
from src.models.claim_models import ExtractionResult


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

TRANSCRIPT_FIXTURE = """
Tim Cook - CEO: We expect Q3 revenue to be approximately $120 billion,
driven by strong iPhone demand in international markets.

Tim Cook - CEO: Q2 revenue was $117 billion, which met our guidance.

Luca Maestri - CFO: We anticipate gross margin of approximately 46 percent for the September quarter.

[Safe harbour: These forward-looking statements involve risks and uncertainties
that could cause actual results to differ materially from those projected.]
"""

VALID_LLM_JSON = """[
  {
    "raw_quote": "We expect Q3 revenue to be approximately $120 billion",
    "claim_type": "revenue",
    "metric": "Q3 revenue",
    "target_value": "120",
    "target_unit": "billion USD",
    "timeframe": "Q3 2024",
    "speaker": "Tim Cook - CEO",
    "quarter": "Q2-2024"
  },
  {
    "raw_quote": "We anticipate gross margin of approximately 46 percent for the September quarter",
    "claim_type": "margin",
    "metric": "gross margin",
    "target_value": "46",
    "target_unit": "percent",
    "timeframe": "Q3 2024",
    "speaker": "Luca Maestri - CFO",
    "quarter": "Q2-2024"
  }
]"""

PARTIAL_LLM_JSON = """[
  {
    "raw_quote": "We expect Q3 revenue to be approximately $120 billion",
    "claim_type": "revenue",
    "metric": "Q3 revenue",
    "target_value": "120",
    "target_unit": "billion USD",
    "timeframe": "Q3 2024",
    "speaker": "Tim Cook - CEO",
    "quarter": "Q2-2024"
  },
  "this is not a valid object"
]"""


def _make_mock_provider(content: str) -> MagicMock:
    mock_response = LLMResponse(
        content=content,
        tool_calls=[],
        model="claude-opus-4-5",
        input_tokens=500,
        output_tokens=200,
    )
    mock_provider = MagicMock()
    mock_provider.complete = AsyncMock(return_value=mock_response)
    return mock_provider


@pytest.fixture(autouse=True)
def _reset_llm_provider():
    """Ensure the LLM provider singleton is reset between tests."""
    reset_provider()
    yield
    reset_provider()


# ---------------------------------------------------------------------------
# Test: AC1 — structured claim output
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_extraction_returns_structured_claims():
    mock_provider = _make_mock_provider(VALID_LLM_JSON)

    with patch("src.core.llm.base._provider", mock_provider):
        from src.services.extraction_service import extract_claims

        result = await extract_claims(
            transcript_text=TRANSCRIPT_FIXTURE,
            ticker="AAPL",
            quarter="Q2-2024",
            job_id="test-job-1",
        )

    assert isinstance(result, ExtractionResult)
    assert len(result.claims) == 2

    first = result.claims[0]
    assert first.raw_quote == "We expect Q3 revenue to be approximately $120 billion"
    assert first.claim_type == "revenue"
    assert first.metric == "Q3 revenue"
    assert first.target_value == "120"
    assert first.target_unit == "billion USD"
    assert first.timeframe == "Q3 2024"
    assert first.speaker == "Tim Cook - CEO"
    assert first.quarter == "Q2-2024"

    assert len(result.errors) == 0
    assert result.ticker == "AAPL"
    assert result.quarter == "Q2-2024"


# ---------------------------------------------------------------------------
# Test: AC2 — no silent drops
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_extraction_no_silent_drops():
    mock_provider = _make_mock_provider(PARTIAL_LLM_JSON)

    with patch("src.core.llm.base._provider", mock_provider):
        from src.services.extraction_service import extract_claims

        result = await extract_claims(
            transcript_text=TRANSCRIPT_FIXTURE,
            ticker="AAPL",
            quarter="Q2-2024",
            job_id="test-job-2",
        )

    # Valid claim is still returned
    assert len(result.claims) == 1
    assert result.claims[0].claim_type == "revenue"

    # Bad segment produces an error, not a silent drop
    assert len(result.errors) == 1
    assert "Claim item is not a JSON object" in result.errors[0].error_reason


@pytest.mark.asyncio
async def test_extraction_empty_response_produces_error():
    mock_response = LLMResponse(
        content=None,
        tool_calls=[],
        model="claude-opus-4-5",
        input_tokens=100,
        output_tokens=0,
    )
    mock_provider = MagicMock()
    mock_provider.complete = AsyncMock(return_value=mock_response)

    with patch("src.core.llm.base._provider", mock_provider):
        from src.services.extraction_service import extract_claims

        result = await extract_claims(
            transcript_text=TRANSCRIPT_FIXTURE,
            ticker="AAPL",
            quarter="Q2-2024",
            job_id="test-job-empty",
        )

    assert len(result.claims) == 0
    assert len(result.errors) == 1
    assert "empty response" in result.errors[0].error_reason


# ---------------------------------------------------------------------------
# Test: NFR17 — LLM called via abstraction only
# ---------------------------------------------------------------------------


def test_llm_called_via_abstraction_only():
    """extraction_service must not import anthropic or openai at the module level."""
    # Force reload to get fresh module state
    if "src.services.extraction_service" in sys.modules:
        del sys.modules["src.services.extraction_service"]

    import src.services.extraction_service as svc_module  # noqa: F401

    # Check module source does not directly import forbidden packages
    import inspect
    source = inspect.getsource(svc_module)
    assert "import anthropic" not in source
    assert "from anthropic" not in source
    assert "import openai" not in source
    assert "from openai" not in source


# ---------------------------------------------------------------------------
# Test: AC4 — cost log emitted after LLM call
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_cost_log_emitted_after_llm_call(caplog):
    import logging

    mock_provider = _make_mock_provider(VALID_LLM_JSON)

    with patch("src.core.llm.base._provider", mock_provider):
        with caplog.at_level(logging.INFO, logger="ml-sidecar.extraction_service"):
            from src.services.extraction_service import extract_claims

            await extract_claims(
                transcript_text=TRANSCRIPT_FIXTURE,
                ticker="AAPL",
                quarter="Q2-2024",
                job_id="test-job-cost",
            )

    # Find the cost log record
    cost_records = [r for r in caplog.records if "LLM call completed" in r.getMessage()]
    assert len(cost_records) >= 1

    record = cost_records[0]
    assert hasattr(record, "model") or "model" in str(record.__dict__)


# ---------------------------------------------------------------------------
# Test: AC3 — insert_claim_batch persists all
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_insert_claim_batch_persists_all():
    from src.db.queries import insert_claim_batch

    mock_conn = AsyncMock()
    mock_conn.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_conn.__aexit__ = AsyncMock(return_value=None)
    mock_conn.transaction = MagicMock(return_value=mock_conn)
    mock_conn.execute = AsyncMock()

    mock_pool = MagicMock()
    mock_pool.acquire = MagicMock(return_value=mock_conn)

    claims = [
        {
            "company_id": "company-uuid-1",
            "quarter": "Q2-2024",
            "raw_quote": "We expect Q3 revenue to be approximately $120 billion",
            "metric": "Q3 revenue",
            "target_value": "120",
            "extraction_confidence": Decimal("0.5"),
            "speaker": "Tim Cook - CEO",
        },
        {
            "company_id": "company-uuid-1",
            "quarter": "Q2-2024",
            "raw_quote": "We anticipate gross margin of approximately 46 percent",
            "metric": "gross margin",
            "target_value": "46",
            "extraction_confidence": Decimal("0.5"),
            "speaker": "Luca Maestri - CFO",
        },
    ]

    with patch("src.db.queries.get_pool", AsyncMock(return_value=mock_pool)):
        row_ids = await insert_claim_batch(claims)

    assert len(row_ids) == 2
    assert mock_conn.execute.call_count == 2


@pytest.mark.asyncio
async def test_insert_claim_batch_empty_returns_empty():
    from src.db.queries import insert_claim_batch

    result = await insert_claim_batch([])
    assert result == []


# ---------------------------------------------------------------------------
# Test: code-fence stripping — single-line fence edge case (P6)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_single_line_code_fence_stripped():
    """LLM response wrapped in a single-line ```...``` must still parse correctly."""
    # Simulate LLM wrapping the array in fences with no language identifier and no trailing newline
    single_line_fenced = "```" + VALID_LLM_JSON.strip() + "```"
    mock_provider = _make_mock_provider(single_line_fenced)

    with patch("src.core.llm.base._provider", mock_provider):
        from src.services.extraction_service import extract_claims

        result = await extract_claims(
            transcript_text=TRANSCRIPT_FIXTURE,
            ticker="AAPL",
            quarter="Q2-2024",
            job_id="test-job-fence",
        )

    assert len(result.claims) == 2
    assert len(result.errors) == 0


# ---------------------------------------------------------------------------
# Test: quarter format validator (P8)
# ---------------------------------------------------------------------------


def test_extracted_claim_rejects_malformed_quarter():
    from src.models.claim_models import ExtractedClaim
    import pytest

    with pytest.raises(Exception, match="quarter"):
        ExtractedClaim(
            raw_quote="We expect Q3 revenue to be $120B",
            claim_type="revenue",
            metric="Q3 revenue",
            target_value="120",
            timeframe="Q3 2024",
            quarter="Q3 2024",  # space instead of dash — invalid
        )
