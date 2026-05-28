"""Tests for PostgreSQL caching and re-ingestion prevention — story 3.6."""
import logging
from unittest.mock import AsyncMock, patch

import pytest

import src.services.financials_service as financials_svc
import src.services.ingestion_service as ingestion_svc
from src.models.financials_models import FinancialMetric
from src.services.financials_service import ingest_financial_actuals
from src.services.ingestion_service import ingest_8k_transcripts


# ── Shared test data ──────────────────────────────────────────────────────────

_CACHED_TRANSCRIPT_ROW = {
    "ticker": "TSLA",
    "quarter": "Q3-2024",
    "filing_date": "2024-10-23",
    "raw_text": "cached transcript body",
    "filing_url": "https://sec.gov/cached/ex991.htm",
    "parse_status": "SUCCESS",
}

_MOCK_METRICS = [
    FinancialMetric(
        ticker="TSLA",
        quarter="Q3-2024",
        metric_name="revenue",
        value="25000000000",
        unit="USD",
        section_reference="us-gaap/Revenues",
        filing_url="https://sec.gov/Archives/edgar/data/1318605/0001-24-001-index.htm",
        filing_type="10-Q",
        parse_status="SUCCESS",
    )
]


def _cached_financials_row():
    return {
        "ticker": "TSLA",
        "quarter": "Q3-2024",
        "filing_type": "10-Q",
        "status": "SUCCESS",
        "filing_url": "https://sec.gov/Archives/edgar/data/1318605/0001-24-001-index.htm",
        "metrics": [m.model_dump() for m in _MOCK_METRICS],  # asyncpg returns list[dict]
    }


# ── Transcript cache hit ──────────────────────────────────────────────────────

async def test_transcript_cache_hit_skips_edgar_fetch():
    """Cache hit must return cached result without any EDGAR HTTP calls."""
    with patch("src.services.ingestion_service.get_cached_transcript",
               new_callable=AsyncMock, return_value=_CACHED_TRANSCRIPT_ROW), \
         patch("src.services.ingestion_service.get_client") as mock_client, \
         patch("src.services.ingestion_service.resolve_cik",
               new_callable=AsyncMock, return_value="0001318605"), \
         patch("src.services.ingestion_service._get_8k_filings",
               new_callable=AsyncMock,
               return_value=[{"accession_no": "0001318605-24-000123", "filing_date": "2024-10-23"}]):
        summary = await ingest_8k_transcripts("TSLA", "2024-10-01", "2024-10-31")

    mock_client.return_value.fetch.assert_not_called()
    assert summary.transcripts_extracted == 1
    assert len(summary.results) == 1
    assert summary.results[0].raw_text == "cached transcript body"
    assert summary.results[0].parse_status == "SUCCESS"


async def test_transcript_cache_hit_logs_cache_hit(caplog):
    """Cache hit must emit a structured log with cache_hit: True."""
    with patch("src.services.ingestion_service.get_cached_transcript",
               new_callable=AsyncMock, return_value=_CACHED_TRANSCRIPT_ROW), \
         patch("src.services.ingestion_service.get_client"), \
         patch("src.services.ingestion_service.resolve_cik",
               new_callable=AsyncMock, return_value="0001318605"), \
         patch("src.services.ingestion_service._get_8k_filings",
               new_callable=AsyncMock,
               return_value=[{"accession_no": "0001318605-24-000123", "filing_date": "2024-10-23"}]):
        with caplog.at_level(logging.INFO, logger="ml-sidecar.ingestion_service"):
            await ingest_8k_transcripts("TSLA", "2024-10-01", "2024-10-31")

    hit_records = [r for r in caplog.records if "transcript cache hit" in r.getMessage()]
    assert len(hit_records) >= 1
    assert getattr(hit_records[0], "cache_hit", None) is True


# ── Transcript cache miss ─────────────────────────────────────────────────────

async def test_transcript_cache_miss_calls_insert_transcript():
    """Cache miss with SUCCESS status must persist the transcript."""
    with patch("src.services.ingestion_service.get_cached_transcript",
               new_callable=AsyncMock, return_value=None), \
         patch("src.services.ingestion_service.insert_transcript",
               new_callable=AsyncMock) as mock_insert, \
         patch("src.services.ingestion_service.resolve_cik",
               new_callable=AsyncMock, return_value="0001318605"), \
         patch("src.services.ingestion_service._get_8k_filings",
               new_callable=AsyncMock,
               return_value=[{"accession_no": "0001318605-24-000123", "filing_date": "2024-10-23"}]), \
         patch("src.services.ingestion_service._get_exhibit_documents",
               new_callable=AsyncMock,
               return_value=[{"type": "EX-99.1", "url": "https://sec.gov/ex991.htm"}]), \
         patch("src.services.ingestion_service._extract_transcript_text",
               new_callable=AsyncMock, return_value=("fresh transcript text", "SUCCESS")):
        summary = await ingest_8k_transcripts("TSLA", "2024-10-01", "2024-10-31")

    mock_insert.assert_called_once()
    kwargs = mock_insert.call_args.kwargs
    assert kwargs["ticker"] == "TSLA"
    assert kwargs["quarter"] == "Q3-2024"
    assert kwargs["parse_status"] == "SUCCESS"
    assert summary.transcripts_extracted == 1


async def test_transcript_cache_miss_logs_cache_miss_with_duration(caplog):
    """Cache miss on SUCCESS path must emit a structured log with fetch_duration_ms."""
    with patch("src.services.ingestion_service.get_cached_transcript",
               new_callable=AsyncMock, return_value=None), \
         patch("src.services.ingestion_service.insert_transcript", new_callable=AsyncMock), \
         patch("src.services.ingestion_service.resolve_cik",
               new_callable=AsyncMock, return_value="0001318605"), \
         patch("src.services.ingestion_service._get_8k_filings",
               new_callable=AsyncMock,
               return_value=[{"accession_no": "0001318605-24-000123", "filing_date": "2024-10-23"}]), \
         patch("src.services.ingestion_service._get_exhibit_documents",
               new_callable=AsyncMock,
               return_value=[{"type": "EX-99.1", "url": "https://sec.gov/ex991.htm"}]), \
         patch("src.services.ingestion_service._extract_transcript_text",
               new_callable=AsyncMock, return_value=("fresh transcript text", "SUCCESS")):
        with caplog.at_level(logging.INFO, logger="ml-sidecar.ingestion_service"):
            await ingest_8k_transcripts("TSLA", "2024-10-01", "2024-10-31")

    miss_records = [r for r in caplog.records if "transcript cache miss" in r.getMessage()]
    assert len(miss_records) >= 1
    assert hasattr(miss_records[0], "fetch_duration_ms")
    assert getattr(miss_records[0], "cache_hit", None) is False


async def test_transcript_parse_failure_not_persisted():
    """PARSE_FAILURE transcript must NOT be inserted into the cache."""
    with patch("src.services.ingestion_service.get_cached_transcript",
               new_callable=AsyncMock, return_value=None), \
         patch("src.services.ingestion_service.insert_transcript",
               new_callable=AsyncMock) as mock_insert, \
         patch("src.services.ingestion_service.resolve_cik",
               new_callable=AsyncMock, return_value="0001318605"), \
         patch("src.services.ingestion_service._get_8k_filings",
               new_callable=AsyncMock,
               return_value=[{"accession_no": "0001318605-24-000123", "filing_date": "2024-10-23"}]), \
         patch("src.services.ingestion_service._get_exhibit_documents",
               new_callable=AsyncMock,
               return_value=[{"type": "EX-99.1", "url": "https://sec.gov/ex991.htm"}]), \
         patch("src.services.ingestion_service._extract_transcript_text",
               new_callable=AsyncMock, return_value=(None, "PARSE_FAILURE")):
        await ingest_8k_transcripts("TSLA", "2024-10-01", "2024-10-31")

    mock_insert.assert_not_called()


# ── Financials cache hit ──────────────────────────────────────────────────────

async def test_financials_cache_hit_skips_edgar_fetch():
    """Financials cache hit must return cached result without any EDGAR HTTP calls."""
    with patch("src.services.financials_service.get_cached_financial_actuals",
               new_callable=AsyncMock, return_value=_cached_financials_row()), \
         patch("src.services.financials_service.get_client") as mock_fin_client, \
         patch("src.services.ingestion_service.get_client") as mock_ing_client:
        result = await ingest_financial_actuals("TSLA", "Q3-2024")

    mock_fin_client.return_value.fetch.assert_not_called()
    mock_ing_client.return_value.fetch.assert_not_called()
    assert result.status == "SUCCESS"
    assert len(result.metrics) == 1
    assert result.metrics[0].metric_name == "revenue"


async def test_financials_cache_hit_logs_cache_hit(caplog):
    """Financials cache hit must emit a structured log with cache_hit: True."""
    with patch("src.services.financials_service.get_cached_financial_actuals",
               new_callable=AsyncMock, return_value=_cached_financials_row()), \
         patch("src.services.financials_service.get_client"), \
         patch("src.services.ingestion_service.get_client"):
        with caplog.at_level(logging.INFO, logger="ml-sidecar.financials_service"):
            await ingest_financial_actuals("TSLA", "Q3-2024")

    hit_records = [r for r in caplog.records if "financial actuals cache hit" in r.getMessage()]
    assert len(hit_records) >= 1
    assert getattr(hit_records[0], "cache_hit", None) is True


# ── Financials cache miss ─────────────────────────────────────────────────────

async def test_financials_cache_miss_calls_insert_financial_actuals():
    """Cache miss with SUCCESS/PARTIAL status must persist the financials result."""
    import httpx

    _tickers = {"0": {"cik_str": 1318605, "ticker": "TSLA", "title": "Tesla Inc"}}
    _submissions = {
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
    _xbrl = {
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
                }
            }
        }
    }

    with patch("src.services.financials_service.get_cached_financial_actuals",
               new_callable=AsyncMock, return_value=None), \
         patch("src.services.financials_service.insert_financial_actuals",
               new_callable=AsyncMock) as mock_insert, \
         patch("src.services.financials_service.get_client") as mock_fin_client, \
         patch("src.services.ingestion_service.get_client") as mock_ing_client:
        mock_ing_client.return_value.fetch = AsyncMock(
            return_value=httpx.Response(200, json=_tickers)
        )
        mock_fin_client.return_value.fetch = AsyncMock(
            side_effect=[
                httpx.Response(200, json=_submissions),
                httpx.Response(200, json=_xbrl),
                # guidance extraction — best-effort, simulate a 404
                httpx.Response(404, text="Not Found"),
            ]
        )
        result = await ingest_financial_actuals("TSLA", "Q3-2024")

    mock_insert.assert_called_once()
    kwargs = mock_insert.call_args.kwargs
    assert kwargs["ticker"] == "TSLA"
    assert kwargs["quarter"] == "Q3-2024"
    assert kwargs["status"] in ("SUCCESS", "PARTIAL")
    assert result.status in ("SUCCESS", "PARTIAL")


async def test_financials_cache_miss_logs_cache_miss_with_duration(caplog):
    """Cache miss on SUCCESS/PARTIAL path must emit a structured log with fetch_duration_ms."""
    import httpx

    _tickers = {"0": {"cik_str": 1318605, "ticker": "TSLA", "title": "Tesla Inc"}}
    _submissions = {
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
    _xbrl = {
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
                }
            }
        }
    }

    with patch("src.services.financials_service.get_cached_financial_actuals",
               new_callable=AsyncMock, return_value=None), \
         patch("src.services.financials_service.insert_financial_actuals", new_callable=AsyncMock), \
         patch("src.services.financials_service.get_client") as mock_fin_client, \
         patch("src.services.ingestion_service.get_client") as mock_ing_client:
        mock_ing_client.return_value.fetch = AsyncMock(
            return_value=httpx.Response(200, json=_tickers)
        )
        mock_fin_client.return_value.fetch = AsyncMock(
            side_effect=[
                httpx.Response(200, json=_submissions),
                httpx.Response(200, json=_xbrl),
                httpx.Response(404, text="Not Found"),
            ]
        )
        with caplog.at_level(logging.INFO, logger="ml-sidecar.financials_service"):
            await ingest_financial_actuals("TSLA", "Q3-2024")

    miss_records = [r for r in caplog.records if "financial actuals cache miss" in r.getMessage()]
    assert len(miss_records) >= 1
    assert hasattr(miss_records[0], "fetch_duration_ms")
    assert getattr(miss_records[0], "cache_hit", None) is False


async def test_financials_fetch_error_not_persisted():
    """FETCH_ERROR result must NOT be inserted into the financials cache."""
    with patch("src.services.financials_service.get_cached_financial_actuals",
               new_callable=AsyncMock, return_value=None), \
         patch("src.services.financials_service.insert_financial_actuals",
               new_callable=AsyncMock) as mock_insert, \
         patch("src.services.financials_service.resolve_cik",
               new_callable=AsyncMock, side_effect=ValueError("Unknown ticker")), \
         patch("src.services.ingestion_service.get_client"):
        result = await ingest_financial_actuals("UNKNOWN", "Q3-2024")

    assert result.status == "FETCH_ERROR"
    mock_insert.assert_not_called()
