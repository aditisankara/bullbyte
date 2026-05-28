"""Tests for src/core/temporal_aligner.py — story 3.4."""
import json
import logging
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

import src.services.ingestion_service as ingestion_svc
from src.core.edgar_models import EdgarFetchError
from src.core.temporal_aligner import (
    _next_quarter,
    _quarter_to_filing_type,
    _quarter_to_period_end,
    align_call_to_actuals,
)
from src.models.alignment_models import AlignmentDecision


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def reset_cik_cache():
    ingestion_svc._TICKER_CIK_MAP = {}
    yield
    ingestion_svc._TICKER_CIK_MAP = {}


@pytest.fixture
def mock_client():
    with patch("src.core.temporal_aligner.get_client") as mock_factory:
        client = MagicMock()
        client.fetch = AsyncMock()
        mock_factory.return_value = client
        yield client


@pytest.fixture
def mock_resolve_cik():
    with patch("src.core.temporal_aligner.resolve_cik", new_callable=AsyncMock) as mock_fn:
        mock_fn.return_value = "0001318605"
        yield mock_fn


# ── Mock payloads ─────────────────────────────────────────────────────────────

MOCK_SUBMISSIONS_FILING_FOUND = {
    "filings": {
        "recent": {
            "accessionNumber": ["0001318605-25-000001"],
            "filingDate": ["2025-01-15"],
            "form": ["10-K"],
        },
        "files": [],
    }
}

MOCK_SUBMISSIONS_NO_MATCH = {
    "filings": {
        "recent": {"accessionNumber": [], "filingDate": [], "form": []},
        "files": [],
    }
}


# ── Quarter arithmetic tests ──────────────────────────────────────────────────

@pytest.mark.parametrize("quarter,expected", [
    ("Q1-2024", "Q2-2024"),
    ("Q2-2024", "Q3-2024"),
    ("Q3-2024", "Q4-2024"),
    ("Q4-2024", "Q1-2025"),
])
def test_next_quarter(quarter, expected):
    assert _next_quarter(quarter) == expected


@pytest.mark.parametrize("quarter,expected", [
    ("Q1-2024", "2024-03-31"),
    ("Q2-2024", "2024-06-30"),
    ("Q3-2024", "2024-09-30"),
    ("Q4-2024", "2024-12-31"),
])
def test_quarter_to_period_end(quarter, expected):
    assert _quarter_to_period_end(quarter) == expected


@pytest.mark.parametrize("quarter,expected", [
    ("Q4-2024", "10-K"),
    ("Q3-2024", "10-Q"),
    ("Q1-2024", "10-Q"),
    ("Q2-2024", "10-Q"),
])
def test_quarter_to_filing_type(quarter, expected):
    assert _quarter_to_filing_type(quarter) == expected


@pytest.mark.parametrize("bad_input", ["bad", "Q5-2024", "Q10-2024", "2024-Q3", ""])
def test_next_quarter_raises_on_bad_input(bad_input):
    with pytest.raises(ValueError):
        _next_quarter(bad_input)


# ── align_call_to_actuals: ALIGNED HIGH ───────────────────────────────────────

@pytest.mark.asyncio
async def test_aligned_high_confidence(mock_client, mock_resolve_cik):
    """Filing found at primary quarter → ALIGNED / HIGH."""
    mock_client.fetch.return_value = httpx.Response(200, json=MOCK_SUBMISSIONS_FILING_FOUND)

    decision = await align_call_to_actuals("TSLA", "Q3-2024")

    assert isinstance(decision, AlignmentDecision)
    assert decision.status == "ALIGNED"
    assert decision.alignment_confidence == "HIGH"
    assert decision.actuals_quarter == "Q4-2024"
    assert decision.filing_url != ""


# ── align_call_to_actuals: PENDING ────────────────────────────────────────────

@pytest.mark.asyncio
async def test_pending_when_no_filings_found(mock_client, mock_resolve_cik):
    """Both primary and alternate quarters return no matches → PENDING."""
    mock_client.fetch.return_value = httpx.Response(200, json=MOCK_SUBMISSIONS_NO_MATCH)

    decision = await align_call_to_actuals("TSLA", "Q3-2024")

    assert decision.status == "PENDING"
    assert decision.alignment_confidence == "LOW"
    assert decision.filing_url == ""


# ── align_call_to_actuals: ALIGNED LOW (fiscal year offset) ──────────────────

@pytest.mark.asyncio
async def test_aligned_low_alternate_quarter(mock_client, mock_resolve_cik):
    """Primary quarter returns nothing; alternate quarter has a filing → ALIGNED / LOW."""
    # Q3-2024 call → primary actuals Q4-2024 (10-K, Jan 2025)
    # Alternate actuals Q1-2025 (10-Q, Apr 2025)
    MOCK_ALT_FILING = {
        "filings": {
            "recent": {
                "accessionNumber": ["0001318605-25-000099"],
                "filingDate": ["2025-04-10"],
                "form": ["10-Q"],
            },
            "files": [],
        }
    }
    mock_client.fetch = AsyncMock(side_effect=[
        httpx.Response(200, json=MOCK_SUBMISSIONS_NO_MATCH),   # primary Q4-2024
        httpx.Response(200, json=MOCK_ALT_FILING),              # alternate Q1-2025
    ])

    decision = await align_call_to_actuals("TSLA", "Q3-2024")

    assert decision.status == "ALIGNED"
    assert decision.alignment_confidence == "LOW"
    assert decision.actuals_quarter == "Q1-2025"
    assert "fiscal year offset" in decision.mapping_rationale
    assert decision.filing_url != ""


# ── align_call_to_actuals: FETCH_ERROR from EdgarFetchError ──────────────────

@pytest.mark.asyncio
async def test_fetch_error_from_edgar(mock_client, mock_resolve_cik):
    """EdgarFetchError during _find_filing_url → FETCH_ERROR decision."""
    mock_client.fetch.side_effect = EdgarFetchError(
        ticker="TSLA", filing_type="submissions", url="http://x", final_status=500
    )

    decision = await align_call_to_actuals("TSLA", "Q3-2024")

    assert decision.status == "FETCH_ERROR"
    assert decision.alignment_confidence == "LOW"
    assert decision.filing_url == ""


# ── align_call_to_actuals: FETCH_ERROR from unknown ticker ───────────────────

@pytest.mark.asyncio
async def test_fetch_error_unknown_ticker(mock_client):
    """resolve_cik raises ValueError → FETCH_ERROR decision."""
    with patch("src.core.temporal_aligner.resolve_cik", new_callable=AsyncMock) as mock_cik:
        mock_cik.side_effect = ValueError("Ticker 'FAKE' not found")
        decision = await align_call_to_actuals("FAKE", "Q3-2024")

    assert decision.status == "FETCH_ERROR"
    assert decision.alignment_confidence == "LOW"
    assert "FAKE" in decision.mapping_rationale
    assert decision.filing_url == ""


# ── align_call_to_actuals: FETCH_ERROR from alt-quarter EdgarFetchError ──────

@pytest.mark.asyncio
async def test_fetch_error_from_alternate_edgar(mock_client, mock_resolve_cik):
    """Primary returns None; alt-quarter EdgarFetchError → FETCH_ERROR (not silently PENDING)."""
    mock_client.fetch = AsyncMock(side_effect=[
        httpx.Response(200, json=MOCK_SUBMISSIONS_NO_MATCH),  # primary Q4-2024: no match
        EdgarFetchError(ticker="TSLA", filing_type="submissions", url="http://x", final_status=500),
    ])

    decision = await align_call_to_actuals("TSLA", "Q3-2024")

    assert decision.status == "FETCH_ERROR"
    assert decision.alignment_confidence == "LOW"
    assert decision.filing_url == ""


# ── NFR8: every decision produces one structured log entry ───────────────────

@pytest.mark.asyncio
async def test_every_decision_is_logged(mock_client, mock_resolve_cik, caplog):
    """Every align_call_to_actuals call emits exactly one structured log record with all 8 fields."""
    mock_client.fetch.return_value = httpx.Response(200, json=MOCK_SUBMISSIONS_FILING_FOUND)

    with caplog.at_level(logging.INFO, logger="ml-sidecar.temporal_aligner"):
        decision = await align_call_to_actuals("TSLA", "Q3-2024")

    log_records = [r for r in caplog.records if r.name == "ml-sidecar.temporal_aligner"]
    assert len(log_records) == 1
    record = log_records[-1]
    required_fields = (
        "ticker", "call_quarter", "actuals_quarter", "filing_type",
        "filing_url", "alignment_confidence", "mapping_rationale", "status",
    )
    record_dict = record.__dict__
    for field in required_fields:
        assert field in record_dict, f"Missing log field: {field}"
