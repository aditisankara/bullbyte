"""Regression tests for the stuck-job / PENDING / fiscal-period / YTD-actuals fixes."""

from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from src.core.filing_selector import select_filing_entry
from src.core.progress_webhook import emit_progress
from src.models.progress_models import ProgressEvent
from src.services.extraction_service import _dedupe_claims, _parse_llm_response
from src.services.financials_service import _extract_xbrl_metrics

pytestmark = pytest.mark.asyncio


def _entry(form, filed, report, acc="0000000000-26-000001"):
    return {"form": form, "filingDate": filed, "reportDate": report, "accessionNumber": acc}


# ── filing selection by report date ───────────────────────────────────────────

async def test_selector_matches_off_calendar_quarter_by_report_date():
    entries = [
        _entry("10-Q", "2025-08-27", "2025-07-27", "nvda-q2"),
        _entry("10-Q", "2025-11-19", "2025-10-26", "nvda-q3"),
    ]
    # Calendar Q3-2025 (ends Sep 30) -> the quarter ended Jul 27 is 65d away, Oct 26 is 26d away.
    assert select_filing_entry(entries, "Q3-2025")["accessionNumber"] == "nvda-q3"
    assert select_filing_entry(entries, "Q2-2025")["accessionNumber"] == "nvda-q2"


async def test_selector_returns_10q_for_december_quarter_of_june_filer():
    entries = [_entry("10-Q", "2026-01-28", "2025-12-31"), _entry("10-K", "2025-07-30", "2025-06-30")]
    got = select_filing_entry(entries, "Q4-2025", "10-K")  # label would have guessed 10-K
    assert got["form"] == "10-Q"


async def test_selector_none_when_period_not_filed_yet():
    entries = [_entry("10-Q", "2026-07-30", "2026-06-30")]
    assert select_filing_entry(entries, "Q3-2026") is None


# ── YTD facts must not be read as the quarter ─────────────────────────────────

def _fact(start, end, val, fp="Q2"):
    return {"start": start, "end": end, "val": val, "fp": fp, "fy": 2026, "form": "10-Q"}


async def test_quarterly_metric_ignores_year_to_date_total():
    xbrl = {"facts": {"us-gaap": {"Revenues": {"units": {"USD": [
        _fact("2026-01-01", "2026-06-30", 382_000, "Q2"),   # 6-month YTD, same end date
        _fact("2026-04-01", "2026-06-30", 190_000, "Q2"),   # the quarter
    ]}}}}}
    metrics = _extract_xbrl_metrics(
        xbrl, "AMZN", "Q2-2026", "10-Q", "https://sec.gov/x", report_date=datetime(2026, 6, 30)
    )
    revenue = next(m for m in metrics if m.metric_name == "revenue" and m.period == "quarterly")
    assert revenue.value == "190000"
    assert revenue.period_end == "2026-06-30"


# ── extraction ────────────────────────────────────────────────────────────────

async def test_extraction_dedupes_same_quote_and_keeps_transcript_quarter():
    quote = "GAAP and non-GAAP gross margins are expected to be 73.0% and 73.5%."
    item = lambda metric: {  # noqa: E731
        "raw_quote": quote, "claim_type": "margin", "metric": metric, "target_value": "73.0",
        "target_unit": "percent", "timeframe": "Q4 FY2025", "speaker": None,
        "quarter": "Q4-2026",  # fiscal label the LLM made up
        "extraction_confidence": 0.9,
    }
    response = MagicMock()
    response.content = '{"claims": %s, "boilerplate": []}' % __import__("json").dumps(
        [item("GAAP gross margin"), item("non-GAAP gross margin")]
    )
    claims, _errors, _bp = _parse_llm_response(response, "Q3-2025", "NVDA", "job-1")
    assert len(claims) == 1
    assert claims[0].quarter == "Q3-2025"
    assert _dedupe_claims(claims) == claims


# ── progress webhook ──────────────────────────────────────────────────────────

def _event(name):
    return ProgressEvent(
        event=name, jobId="job-1", stepIndex=1, totalSteps=1, message="m",
        timestamp="2026-01-01T00:00:00Z",
    )


async def test_terminal_event_is_retried_after_429(monkeypatch):
    monkeypatch.setenv("NESTJS_WEBHOOK_URL", "http://api/internal")
    monkeypatch.setattr("src.core.progress_webhook._RETRY_DELAY_SECONDS", 0)
    responses = [httpx.Response(429), httpx.Response(202)]
    post = AsyncMock(side_effect=responses)
    with patch("httpx.AsyncClient.post", post):
        await emit_progress(_event("analysis-complete"))
    assert post.await_count == 2


async def test_non_terminal_event_is_not_retried(monkeypatch):
    monkeypatch.setenv("NESTJS_WEBHOOK_URL", "http://api/internal")
    post = AsyncMock(return_value=httpx.Response(429))
    with patch("httpx.AsyncClient.post", post):
        await emit_progress(_event("claim-verified"))
    assert post.await_count == 1


# ── actual selection: quarter vs full year ────────────────────────────────────

async def test_actual_metric_prefers_quarterly_unless_claim_is_full_year():
    from src.models.financials_models import FinancialMetric
    from src.services.verification_service import _pick_actual_metric

    def m(period, value):
        return FinancialMetric(
            ticker="AMZN", quarter="Q4-2025", metric_name="operating_income", value=value,
            unit="USD", section_reference="x", filing_url="u", filing_type="10-K",
            parse_status="SUCCESS", period=period,
        )

    metrics = [m("annual", "79975000000"), m("quarterly", "23852000000")]
    quarterly = _pick_actual_metric(metrics, "operating_income", "Q4 operating income", "Q4 2025")
    assert quarterly.value == "23852000000"
    annual = _pick_actual_metric(metrics, "operating_income", "operating income", "full-year 2025 guidance")
    assert annual.value == "79975000000"
