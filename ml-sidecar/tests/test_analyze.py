"""Tests for the /analyze/{ticker} endpoint (story 4.1)."""

import pytest
from unittest.mock import AsyncMock, patch

# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

_MOCK_COMPANY_ID = "mock-company-uuid"
_MOCK_TRANSCRIPTS = [{"quarter": "Q1-2024", "raw_text": "Test transcript text."}]

# Patch targets for the preflight DB calls (imported into the router module)
_PATCH_COMPANY = "src.routers.analysis_router.get_company_id_by_ticker"
_PATCH_TRANSCRIPTS = "src.routers.analysis_router.get_all_transcripts_for_ticker"
_PATCH_RUN = "src.routers.analysis_router._run_extraction"


# ---------------------------------------------------------------------------
# Happy-path tests
# ---------------------------------------------------------------------------


def test_analyze_returns_202(client):
    with (
        patch(_PATCH_COMPANY, AsyncMock(return_value=_MOCK_COMPANY_ID)),
        patch(_PATCH_TRANSCRIPTS, AsyncMock(return_value=_MOCK_TRANSCRIPTS)),
        patch(_PATCH_RUN, AsyncMock()),
    ):
        response = client.post("/analyze/AAPL", json={"jobId": "test-job-1"})
    assert response.status_code == 202


def test_analyze_returns_queued_payload(client):
    with (
        patch(_PATCH_COMPANY, AsyncMock(return_value=_MOCK_COMPANY_ID)),
        patch(_PATCH_TRANSCRIPTS, AsyncMock(return_value=_MOCK_TRANSCRIPTS)),
        patch(_PATCH_RUN, AsyncMock()),
    ):
        response = client.post("/analyze/AAPL", json={"jobId": "test-job-2"})
    data = response.json()
    assert data["jobId"] == "test-job-2"
    assert data["status"] == "QUEUED"


def test_analyze_accepts_any_ticker(client):
    with (
        patch(_PATCH_COMPANY, AsyncMock(return_value=_MOCK_COMPANY_ID)),
        patch(_PATCH_TRANSCRIPTS, AsyncMock(return_value=_MOCK_TRANSCRIPTS)),
        patch(_PATCH_RUN, AsyncMock()),
    ):
        for ticker in ("MSFT", "GOOGL", "TSLA", "BRK.A"):
            response = client.post(f"/analyze/{ticker}", json={"jobId": f"job-{ticker}"})
            assert response.status_code == 202


# ---------------------------------------------------------------------------
# Preflight error tests
# ---------------------------------------------------------------------------


def test_analyze_returns_404_when_company_not_found(client):
    """Synchronous 404 when the ticker has no companies row — no silent background failure."""
    with patch(_PATCH_COMPANY, AsyncMock(return_value=None)):
        response = client.post("/analyze/FAKEXYZ", json={"jobId": "job-404"})
    assert response.status_code == 404


def test_analyze_dispatches_when_no_transcripts_yet(client):
    """202 is returned even with no pre-ingested transcripts — ingestion is chained inside the background task."""
    with (
        patch(_PATCH_COMPANY, AsyncMock(return_value=_MOCK_COMPANY_ID)),
        patch(_PATCH_RUN, AsyncMock()),
    ):
        response = client.post("/analyze/NOTINGESTED", json={"jobId": "job-no-transcripts"})
    assert response.status_code == 202


# ---------------------------------------------------------------------------
# Background task safety test
# ---------------------------------------------------------------------------


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
