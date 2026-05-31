"""Tests for the /analyze/{ticker} endpoint (story 4.1)."""

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
