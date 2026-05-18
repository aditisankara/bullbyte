"""Tests for the /analyze/{ticker} stub endpoint (AC4)."""


def test_analyze_returns_202(client):
    response = client.post("/analyze/AAPL")
    assert response.status_code == 202


def test_analyze_returns_stub_payload(client):
    response = client.post("/analyze/AAPL")
    assert response.json() == {"jobId": "stub", "status": "QUEUED"}


def test_analyze_accepts_any_ticker(client):
    for ticker in ("MSFT", "GOOGL", "TSLA", "BRK.A"):
        response = client.post(f"/analyze/{ticker}")
        assert response.status_code == 202
