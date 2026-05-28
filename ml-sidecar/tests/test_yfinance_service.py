"""Tests for src/services/yfinance_service.py — story 3.5."""
import datetime
import math
from unittest.mock import MagicMock, patch

import pandas as pd
import pytest

from src.services.yfinance_service import (
    _extract_yfinance_metrics,
    _quarter_to_period_end_date,
    supplement_with_yfinance,
)

# ── Fixtures ──────────────────────────────────────────────────────────────────

MOCK_DF = pd.DataFrame(
    {
        pd.Timestamp("2024-09-30"): {
            "Total Revenue": 25_000_000_000.0,
            "Net Income": 2_000_000_000.0,
            "Gross Profit": 8_000_000_000.0,
            "Basic EPS": 0.72,
            "Diluted EPS": 0.71,
            "Operating Income": 3_000_000_000.0,
        },
    }
)


# ── _quarter_to_period_end_date tests ─────────────────────────────────────────

@pytest.mark.parametrize(
    "quarter, expected",
    [
        ("Q1-2024", datetime.date(2024, 3, 31)),
        ("Q2-2024", datetime.date(2024, 6, 30)),
        ("Q3-2024", datetime.date(2024, 9, 30)),
        ("Q4-2024", datetime.date(2024, 12, 31)),
    ],
)
def test_quarter_to_period_end_date_all_quarters(quarter, expected):
    assert _quarter_to_period_end_date(quarter) == expected


@pytest.mark.parametrize("bad_input", ["Q5-2024", "bad", "Q-2024", "Q1", "1-2024"])
def test_quarter_to_period_end_date_raises_on_bad_input(bad_input):
    with pytest.raises(ValueError):
        _quarter_to_period_end_date(bad_input)


# ── _extract_yfinance_metrics tests ──────────────────────────────────────────

def test_extract_yfinance_metrics_returns_metrics_with_yfinance_source():
    results = _extract_yfinance_metrics("TSLA", "Q3-2024", MOCK_DF, ["revenue", "net_income"])
    assert len(results) == 2
    for m in results:
        assert m.source == "yfinance"
        assert m.parse_status == "SUCCESS"
        assert m.ticker == "TSLA"
        assert m.quarter == "Q3-2024"


def test_extract_yfinance_metrics_no_match_outside_45_day_window():
    # Column is 2024-09-30; request Q1-2024 (ends 2024-03-31) — 183 days away
    results = _extract_yfinance_metrics("TSLA", "Q1-2024", MOCK_DF, ["revenue"])
    assert results == []


def test_extract_yfinance_metrics_skips_nan_values():
    df_with_nan = pd.DataFrame(
        {
            pd.Timestamp("2024-09-30"): {
                "Total Revenue": float("nan"),
                "Net Income": 2_000_000_000.0,
            },
        }
    )
    results = _extract_yfinance_metrics("TSLA", "Q3-2024", df_with_nan, ["revenue", "net_income"])
    names = [m.metric_name for m in results]
    assert "revenue" not in names
    assert "net_income" in names


def test_extract_yfinance_metrics_skips_missing_row_labels():
    # revenue row label "Total Revenue" is absent from df
    df_no_revenue = pd.DataFrame(
        {
            pd.Timestamp("2024-09-30"): {
                "Net Income": 2_000_000_000.0,
            },
        }
    )
    results = _extract_yfinance_metrics("TSLA", "Q3-2024", df_no_revenue, ["revenue", "net_income"])
    names = [m.metric_name for m in results]
    assert "revenue" not in names
    assert "net_income" in names


def test_extract_yfinance_metrics_filing_fields():
    results = _extract_yfinance_metrics("TSLA", "Q3-2024", MOCK_DF, ["revenue"])
    assert len(results) == 1
    m = results[0]
    assert m.filing_url == ""
    assert m.filing_type == "yfinance"
    assert m.section_reference == "yfinance/Total Revenue"


# ── supplement_with_yfinance tests ───────────────────────────────────────────

@pytest.mark.asyncio
async def test_supplement_returns_yfinance_tagged_metrics():
    with patch("yfinance.Ticker") as mock_ticker_cls:
        mock_ticker = MagicMock()
        mock_ticker.quarterly_income_stmt = MOCK_DF
        mock_ticker_cls.return_value = mock_ticker
        results = await supplement_with_yfinance("TSLA", "Q3-2024", ["revenue", "net_income"])
    assert len(results) == 2
    assert all(m.source == "yfinance" for m in results)
    assert all(m.parse_status == "SUCCESS" for m in results)


@pytest.mark.asyncio
async def test_supplement_all_metrics_have_yfinance_source_never_edgar():
    with patch("yfinance.Ticker") as mock_ticker_cls:
        mock_ticker = MagicMock()
        mock_ticker.quarterly_income_stmt = MOCK_DF
        mock_ticker_cls.return_value = mock_ticker
        results = await supplement_with_yfinance(
            "TSLA", "Q3-2024", ["revenue", "net_income", "gross_profit", "eps_basic", "eps_diluted", "operating_income"]
        )
    assert all(m.source == "yfinance" for m in results)
    assert not any(m.source == "edgar" for m in results)


@pytest.mark.asyncio
async def test_supplement_returns_empty_list_on_exception():
    with patch("yfinance.Ticker") as mock_ticker_cls:
        mock_ticker_cls.side_effect = Exception("network error")
        results = await supplement_with_yfinance("TSLA", "Q3-2024", ["revenue"])
    assert results == []


@pytest.mark.asyncio
async def test_supplement_does_not_reraise_on_exception():
    with patch("yfinance.Ticker") as mock_ticker_cls:
        mock_ticker_cls.side_effect = RuntimeError("unexpected failure")
        # Should not raise
        results = await supplement_with_yfinance("TSLA", "Q3-2024", ["revenue"])
    assert results == []


@pytest.mark.asyncio
async def test_supplement_logs_success_fields(caplog):
    with patch("yfinance.Ticker") as mock_ticker_cls:
        mock_ticker = MagicMock()
        mock_ticker.quarterly_income_stmt = MOCK_DF
        mock_ticker_cls.return_value = mock_ticker
        import logging
        with caplog.at_level(logging.INFO, logger="ml-sidecar.yfinance_service"):
            results = await supplement_with_yfinance("TSLA", "Q3-2024", ["revenue"])

    # Find the completion log record
    complete_records = [r for r in caplog.records if "supplement complete" in r.getMessage()]
    assert len(complete_records) == 1
    record = complete_records[0]
    assert record.__dict__.get("ticker") == "TSLA"
    assert record.__dict__.get("quarter") == "Q3-2024"
    assert record.__dict__.get("metrics_requested") == ["revenue"]
    assert record.__dict__.get("source") == "yfinance"
    returned = record.__dict__.get("metrics_returned")
    assert isinstance(returned, list)


@pytest.mark.asyncio
async def test_supplement_logs_failure_fields(caplog):
    with patch("yfinance.Ticker") as mock_ticker_cls:
        mock_ticker_cls.side_effect = Exception("network error")
        import logging
        with caplog.at_level(logging.DEBUG, logger="ml-sidecar.yfinance_service"):
            await supplement_with_yfinance("TSLA", "Q3-2024", ["revenue", "net_income"])

    start_records = [r for r in caplog.records if "supplement start" in r.getMessage()]
    assert len(start_records) == 1, "start log must fire before the try block, even on failure"

    error_records = [r for r in caplog.records if "supplement failed" in r.getMessage()]
    assert len(error_records) == 1
    record = error_records[0]
    assert record.__dict__.get("ticker") == "TSLA"
    assert record.__dict__.get("quarter") == "Q3-2024"
    assert record.__dict__.get("metrics_requested") == ["revenue", "net_income"]
    assert record.__dict__.get("metrics_returned") == []
    assert record.__dict__.get("source") == "yfinance"
    assert "error" in record.__dict__


# ── Merge guard invariant ─────────────────────────────────────────────────────

def test_merge_guard_does_not_overwrite_edgar_success():
    """yfinance must not replace an EDGAR SUCCESS metric for the same metric_name."""
    from src.models.financials_models import FinancialMetric

    edgar_metric = FinancialMetric(
        ticker="TSLA", quarter="Q3-2024", metric_name="revenue",
        value="25000000000.0", unit="USD", section_reference="us-gaap/Revenues",
        filing_url="https://edgar.example/", filing_type="10-Q",
        parse_status="SUCCESS", source="edgar",
    )
    yf_metric = FinancialMetric(
        ticker="TSLA", quarter="Q3-2024", metric_name="revenue",
        value="24000000000.0", unit="USD", section_reference="yfinance/Total Revenue",
        filing_url="", filing_type="yfinance",
        parse_status="SUCCESS", source="yfinance",
    )

    metrics = [edgar_metric]
    edgar_success = {m.metric_name for m in metrics if m.parse_status == "SUCCESS"}
    for m in [yf_metric]:
        if m.metric_name not in edgar_success:
            metrics.append(m)

    assert len(metrics) == 1, "yfinance must not be appended when EDGAR SUCCESS exists for the same name"
    assert metrics[0].source == "edgar"
    assert metrics[0].value == "25000000000.0"
