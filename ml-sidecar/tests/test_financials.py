"""Tests for src/services/financials_service.py — story 3.3."""
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

import src.services.ingestion_service as ingestion_svc
from src.core.edgar_models import EdgarFetchError
from src.services.financials_service import (
    _extract_xbrl_metrics,
    _find_filing_accession,
    _quarter_to_filing_type,
    _quarter_to_period_end,
    ingest_financial_actuals,
)


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def reset_cik_cache():
    ingestion_svc._TICKER_CIK_MAP = {}
    yield
    ingestion_svc._TICKER_CIK_MAP = {}


@pytest.fixture
def mock_client():
    with patch("src.services.financials_service.get_client") as mock_factory:
        client = MagicMock()
        client.fetch = AsyncMock()
        mock_factory.return_value = client
        yield client


@pytest.fixture
def mock_ingestion_client():
    """Patch the ingestion_service client for resolve_cik calls."""
    with patch("src.services.ingestion_service.get_client") as mock_factory:
        client = MagicMock()
        client.fetch = AsyncMock()
        mock_factory.return_value = client
        yield client


# ── Minimal XBRL data ─────────────────────────────────────────────────────────

MOCK_XBRL = {
    "facts": {
        "us-gaap": {
            "RevenueFromContractWithCustomerExcludingAssessedTax": {
                "units": {
                    "USD": [
                        {
                            "end": "2024-09-30",
                            "val": 25182000000,
                            "form": "10-Q",
                            "fp": "Q3",
                            "fy": 2024,
                            "filed": "2024-10-23",
                            "accn": "0001-24-001",
                        }
                    ]
                }
            },
            "EarningsPerShareDiluted": {
                "units": {
                    "USD/shares": [
                        {
                            "end": "2024-09-30",
                            "val": 0.72,
                            "form": "10-Q",
                            "fp": "Q3",
                            "fy": 2024,
                            "filed": "2024-10-23",
                            "accn": "0001-24-001",
                        }
                    ]
                }
            },
        }
    }
}

_TICKERS_JSON = {"0": {"cik_str": 1318605, "ticker": "TSLA", "title": "Tesla Inc"}}

_SUBMISSIONS_JSON = {
    "cik": "1318605",
    "filings": {
        "recent": {
            "accessionNumber": ["0001318605-24-000086"],
            "filingDate": ["2024-10-23"],
            "form": ["10-Q"],
        },
        "files": [],
    },
}


# ── Task 3 tests: _quarter_to_filing_type ─────────────────────────────────────

def test_quarter_to_filing_type_returns_10q_for_non_q4():
    assert _quarter_to_filing_type("Q1-2024") == "10-Q"
    assert _quarter_to_filing_type("Q2-2024") == "10-Q"
    assert _quarter_to_filing_type("Q3-2024") == "10-Q"


def test_quarter_to_filing_type_returns_10k_for_q4():
    assert _quarter_to_filing_type("Q4-2024") == "10-K"


# ── Task 5 tests: _quarter_to_period_end ─────────────────────────────────────

@pytest.mark.parametrize("quarter,expected", [
    ("Q1-2024", "2024-03-31"),
    ("Q2-2024", "2024-06-30"),
    ("Q3-2024", "2024-09-30"),
    ("Q4-2023", "2023-12-31"),
])
def test_quarter_to_period_end(quarter, expected):
    assert _quarter_to_period_end(quarter) == expected


# ── Task 6 tests: _extract_xbrl_metrics ──────────────────────────────────────

def test_extract_xbrl_metrics_extracts_revenue_from_primary_concept():
    metrics = _extract_xbrl_metrics(MOCK_XBRL, "TSLA", "Q3-2024", "10-Q", "https://sec.gov/test")
    revenue = next((m for m in metrics if m.metric_name == "revenue"), None)
    assert revenue is not None
    assert revenue.value == "25182000000"
    assert revenue.parse_status == "SUCCESS"
    assert "RevenueFromContractWithCustomerExcludingAssessedTax" in revenue.section_reference


def test_extract_xbrl_metrics_falls_back_to_revenues_concept():
    xbrl = {
        "facts": {
            "us-gaap": {
                "Revenues": {
                    "units": {
                        "USD": [
                            {
                                "end": "2024-09-30",
                                "val": 10000000,
                                "form": "10-Q",
                                "fp": "Q3",
                                "fy": 2024,
                                "filed": "2024-10-20",
                                "accn": "0002-24-001",
                            }
                        ]
                    }
                }
            }
        }
    }
    metrics = _extract_xbrl_metrics(xbrl, "ACME", "Q3-2024", "10-Q", "https://sec.gov/test")
    revenue = next((m for m in metrics if m.metric_name == "revenue"), None)
    assert revenue is not None
    assert revenue.value == "10000000"
    assert "Revenues" in revenue.section_reference


def test_extract_xbrl_metrics_ambiguous_when_two_revenue_concepts_conflict():
    xbrl = {
        "facts": {
            "us-gaap": {
                "RevenueFromContractWithCustomerExcludingAssessedTax": {
                    "units": {
                        "USD": [
                            {
                                "end": "2024-09-30",
                                "val": 25000000000,
                                "form": "10-Q",
                                "fp": "Q3",
                                "fy": 2024,
                                "filed": "2024-10-23",
                                "accn": "0001-24-001",
                            }
                        ]
                    }
                },
                # A second concept also matching — simulated by injecting into the loop
                # We test ambiguity by patching XBRL_METRIC_CONCEPTS in-line
            }
        }
    }
    # Build a scenario where two concepts yield conflicting values for the same metric
    # by constructing xbrl with two concepts and temporarily altering the concept map
    xbrl_two_concepts = {
        "facts": {
            "us-gaap": {
                "RevenueFromContractWithCustomerExcludingAssessedTax": {
                    "units": {
                        "USD": [
                            {
                                "end": "2024-09-30",
                                "val": 25000000000,
                                "form": "10-Q",
                                "fp": "Q3",
                                "fy": 2024,
                                "filed": "2024-10-23",
                                "accn": "0001-24-001",
                            }
                        ]
                    }
                },
                "Revenues": {
                    "units": {
                        "USD": [
                            {
                                "end": "2024-09-30",
                                "val": 99000000000,  # different value → ambiguous
                                "form": "10-Q",
                                "fp": "Q3",
                                "fy": 2024,
                                "filed": "2024-10-24",
                                "accn": "0001-24-002",
                            }
                        ]
                    }
                },
            }
        }
    }
    import src.services.financials_service as fsvc

    original = fsvc.XBRL_METRIC_CONCEPTS["revenue"]
    fsvc.XBRL_METRIC_CONCEPTS["revenue"] = [
        ("us-gaap", "RevenueFromContractWithCustomerExcludingAssessedTax"),
        ("us-gaap", "Revenues"),
    ]
    try:
        metrics = _extract_xbrl_metrics(xbrl_two_concepts, "TSLA", "Q3-2024", "10-Q", "https://sec.gov/test")
    finally:
        fsvc.XBRL_METRIC_CONCEPTS["revenue"] = original

    revenue = next((m for m in metrics if m.metric_name == "revenue"), None)
    assert revenue is not None
    assert revenue.parse_status == "AMBIGUOUS"


def test_extract_xbrl_metrics_derives_gross_margin_when_both_available():
    xbrl = {
        "facts": {
            "us-gaap": {
                "RevenueFromContractWithCustomerExcludingAssessedTax": {
                    "units": {
                        "USD": [
                            {
                                "end": "2024-09-30",
                                "val": 100000000,
                                "form": "10-Q",
                                "fp": "Q3",
                                "fy": 2024,
                                "filed": "2024-10-23",
                                "accn": "0001-24-001",
                            }
                        ]
                    }
                },
                "GrossProfit": {
                    "units": {
                        "USD": [
                            {
                                "end": "2024-09-30",
                                "val": 20000000,
                                "form": "10-Q",
                                "fp": "Q3",
                                "fy": 2024,
                                "filed": "2024-10-23",
                                "accn": "0001-24-001",
                            }
                        ]
                    }
                },
            }
        }
    }
    metrics = _extract_xbrl_metrics(xbrl, "TSLA", "Q3-2024", "10-Q", "https://sec.gov/test")
    gm = next((m for m in metrics if m.metric_name == "gross_margin"), None)
    assert gm is not None
    assert gm.unit == "ratio"
    assert gm.section_reference == "derived:gross_profit/revenue"
    assert float(gm.value) == pytest.approx(0.2, rel=1e-4)


def test_extract_xbrl_metrics_period_end_tolerance_45_days():
    """Entry with end date 2024-10-05 (5 days past Q3-2024 end) should match."""
    xbrl = {
        "facts": {
            "us-gaap": {
                "RevenueFromContractWithCustomerExcludingAssessedTax": {
                    "units": {
                        "USD": [
                            {
                                "end": "2024-10-05",  # 5 days past 2024-09-30, within ±45 days
                                "val": 12345678,
                                "form": "10-Q",
                                "fp": "Q3",
                                "fy": 2024,
                                "filed": "2024-11-01",
                                "accn": "0001-24-001",
                            }
                        ]
                    }
                }
            }
        }
    }
    metrics = _extract_xbrl_metrics(xbrl, "ACME", "Q3-2024", "10-Q", "https://sec.gov/test")
    revenue = next((m for m in metrics if m.metric_name == "revenue"), None)
    assert revenue is not None
    assert revenue.value == "12345678"


# ── Task 8 tests: _find_filing_accession ─────────────────────────────────────

async def test_find_filing_accession_returns_correct_accession(mock_client):
    mock_client.fetch.return_value = httpx.Response(200, json=_SUBMISSIONS_JSON)
    result = await _find_filing_accession("0001318605", "TSLA", "Q3-2024", "10-Q")
    assert result == "0001318605-24-000086"


async def test_find_filing_accession_returns_none_when_no_match(mock_client):
    submissions_no_match = {
        "cik": "1318605",
        "filings": {
            "recent": {
                "accessionNumber": ["0001318605-23-000100"],
                "filingDate": ["2023-10-20"],
                "form": ["10-Q"],
            },
            "files": [],
        },
    }
    mock_client.fetch.return_value = httpx.Response(200, json=submissions_no_match)
    result = await _find_filing_accession("0001318605", "TSLA", "Q3-2024", "10-Q")
    assert result is None


# ── Task 9 tests: ingest_financial_actuals ────────────────────────────────────

async def test_ingest_financial_actuals_filing_not_yet_available(mock_client, mock_ingestion_client):
    mock_ingestion_client.fetch.return_value = httpx.Response(200, json=_TICKERS_JSON)
    submissions_no_match = {
        "cik": "1318605",
        "filings": {
            "recent": {
                "accessionNumber": [],
                "filingDate": [],
                "form": [],
            },
            "files": [],
        },
    }
    mock_client.fetch.return_value = httpx.Response(200, json=submissions_no_match)
    result = await ingest_financial_actuals("TSLA", "Q3-2024")
    assert result.status == "FILING_NOT_YET_AVAILABLE"
    assert result.metrics == []


async def test_ingest_financial_actuals_fetch_error_on_xbrl(mock_client, mock_ingestion_client):
    mock_ingestion_client.fetch.return_value = httpx.Response(200, json=_TICKERS_JSON)
    mock_client.fetch.side_effect = [
        httpx.Response(200, json=_SUBMISSIONS_JSON),  # submissions
        EdgarFetchError(ticker="TSLA", filing_type="xbrl-facts", url="https://x", final_status=503),
    ]
    result = await ingest_financial_actuals("TSLA", "Q3-2024")
    assert result.status == "FETCH_ERROR"
    assert result.metrics == []


async def test_ingest_financial_actuals_returns_metrics_on_success(mock_client, mock_ingestion_client):
    mock_ingestion_client.fetch.return_value = httpx.Response(200, json=_TICKERS_JSON)
    mock_client.fetch.side_effect = [
        httpx.Response(200, json=_SUBMISSIONS_JSON),     # submissions lookup
        httpx.Response(200, json=MOCK_XBRL),             # XBRL facts
        EdgarFetchError(ticker="TSLA", filing_type="filing-index", url="https://x", final_status=404),  # guidance → best-effort
    ]
    result = await ingest_financial_actuals("TSLA", "Q3-2024")
    assert result.status in ("SUCCESS", "PARTIAL")
    assert len(result.metrics) > 0
    metric_names = [m.metric_name for m in result.metrics]
    assert "revenue" in metric_names


async def test_ingest_financial_actuals_guidance_failure_does_not_prevent_success(mock_client, mock_ingestion_client):
    """Guidance fetch error must not prevent the overall result from succeeding."""
    mock_ingestion_client.fetch.return_value = httpx.Response(200, json=_TICKERS_JSON)
    mock_client.fetch.side_effect = [
        httpx.Response(200, json=_SUBMISSIONS_JSON),   # submissions
        httpx.Response(200, json=MOCK_XBRL),           # XBRL facts
        EdgarFetchError(ticker="TSLA", filing_type="filing-index", url="https://x", final_status=404),  # guidance fails
    ]
    result = await ingest_financial_actuals("TSLA", "Q3-2024")
    # Metrics should still be present from XBRL extraction
    assert len(result.metrics) > 0
    assert result.status in ("SUCCESS", "PARTIAL")
