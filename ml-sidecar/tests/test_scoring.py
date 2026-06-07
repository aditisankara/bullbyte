"""Tests for CEO Delivery Score computation (story 4.6)."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from src.models.score_models import CeoDeliveryScore
from src.services.scoring_service import compute_ceo_delivery_score


def _mock_verdict_rows(counts: dict[str, int]) -> list[dict]:
    """Build fake asyncpg-style record rows from a verdict_type → count dict."""
    return [{"verdict_type": vtype, "count": count} for vtype, count in counts.items()]


@pytest.mark.asyncio
async def test_score_computed_from_mixed_verdicts():
    """6 delivered, 4 missed → score = 0.6, total_resolved = 10."""
    rows = _mock_verdict_rows({"DELIVERED": 6, "MISSED": 4, "INSUFFICIENT_DATA": 2, "PENDING": 1})
    with patch(
        "src.services.scoring_service.get_verdicts_for_ticker",
        new=AsyncMock(return_value=rows),
    ):
        result = await compute_ceo_delivery_score("AAPL")

    assert isinstance(result, CeoDeliveryScore)
    assert result.score == pytest.approx(0.6)
    assert result.delivered_count == 6
    assert result.missed_count == 4
    assert result.total_resolved == 10
    assert result.insufficient_data_count == 2
    assert result.pending_count == 1


@pytest.mark.asyncio
async def test_total_resolved_excludes_insufficient_and_pending():
    """INSUFFICIENT_DATA and PENDING are NOT counted in total_resolved (AC1)."""
    rows = _mock_verdict_rows({"DELIVERED": 3, "INSUFFICIENT_DATA": 10, "PENDING": 5})
    with patch(
        "src.services.scoring_service.get_verdicts_for_ticker",
        new=AsyncMock(return_value=rows),
    ):
        result = await compute_ceo_delivery_score("TSLA")

    assert result.total_resolved == 3
    assert result.score == pytest.approx(1.0)
    assert result.insufficient_data_count == 10
    assert result.pending_count == 5


@pytest.mark.asyncio
async def test_score_null_when_no_resolved_claims():
    """All claims PENDING or INSUFFICIENT_DATA → score is None, not 0.0 (AC3)."""
    rows = _mock_verdict_rows({"PENDING": 3, "INSUFFICIENT_DATA": 2})
    with patch(
        "src.services.scoring_service.get_verdicts_for_ticker",
        new=AsyncMock(return_value=rows),
    ):
        result = await compute_ceo_delivery_score("MSFT")

    assert result.score is None
    assert result.total_resolved == 0
    assert result.context_message == "No resolved claims yet"


@pytest.mark.asyncio
async def test_score_null_when_no_verdicts_at_all():
    """Empty ticker (unknown or unanalysed) → score is None, no ZeroDivisionError (AC3)."""
    with patch(
        "src.services.scoring_service.get_verdicts_for_ticker",
        new=AsyncMock(return_value=[]),
    ):
        result = await compute_ceo_delivery_score("UNKN")

    assert result.score is None
    assert result.total_resolved == 0
    assert result.delivered_count == 0
    assert result.missed_count == 0


@pytest.mark.asyncio
async def test_context_message_always_present():
    """context_message is a non-empty string for both null and non-null score paths (AC2)."""
    with patch(
        "src.services.scoring_service.get_verdicts_for_ticker",
        new=AsyncMock(return_value=[]),
    ):
        no_score = await compute_ceo_delivery_score("EMPTY")
    assert no_score.context_message and len(no_score.context_message) > 0

    rows = _mock_verdict_rows({"DELIVERED": 2, "MISSED": 1})
    with patch(
        "src.services.scoring_service.get_verdicts_for_ticker",
        new=AsyncMock(return_value=rows),
    ):
        has_score = await compute_ceo_delivery_score("AAPL")
    assert has_score.context_message and len(has_score.context_message) > 0


@pytest.mark.asyncio
async def test_get_verdicts_for_ticker_called_with_correct_ticker():
    """get_verdicts_for_ticker receives the ticker string passed to compute_ceo_delivery_score."""
    mock_query = AsyncMock(return_value=[])
    with patch("src.services.scoring_service.get_verdicts_for_ticker", new=mock_query):
        await compute_ceo_delivery_score("NVDA")
    mock_query.assert_called_once_with("NVDA")
