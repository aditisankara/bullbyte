"""Tests for the /analyze/{ticker} endpoint (story 4.1)."""

import pytest
from unittest.mock import AsyncMock, patch


def test_analyze_returns_202(client):
    with patch("src.routers.analysis_router._run_extraction", AsyncMock()):
        response = client.post("/analyze/AAPL", json={"jobId": "test-job-1"})
    assert response.status_code == 202


def test_analyze_returns_queued_payload(client):
    with patch("src.routers.analysis_router._run_extraction", AsyncMock()):
        response = client.post("/analyze/AAPL", json={"jobId": "test-job-2"})
    data = response.json()
    assert data["jobId"] == "test-job-2"
    assert data["status"] == "QUEUED"


def test_analyze_accepts_any_ticker(client):
    with patch("src.routers.analysis_router._run_extraction", AsyncMock()):
        for ticker in ("MSFT", "GOOGL", "TSLA", "BRK.A"):
            response = client.post(f"/analyze/{ticker}", json={"jobId": f"job-{ticker}"})
            assert response.status_code == 202


@pytest.mark.asyncio
async def test_run_extraction_emits_failed_on_unhandled_exception():
    """Unhandled exception inside _do_extraction must emit analysis-failed, not silently disappear."""
    from src.routers.analysis_router import _run_extraction

    emitted_events = []

    async def mock_emit(event):
        emitted_events.append(event)

    with (
        patch("src.routers.analysis_router._do_extraction", AsyncMock(side_effect=RuntimeError("boom"))),
        patch("src.routers.analysis_router.emit_progress", mock_emit),
    ):
        await _run_extraction("AAPL", "job-fail-test")

    assert len(emitted_events) == 1
    assert emitted_events[0].event == "analysis-failed"
