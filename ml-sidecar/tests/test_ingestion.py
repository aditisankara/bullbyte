"""Tests for src/services/ingestion_service.py — story 3.2."""
import textwrap
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

import src.services.ingestion_service as svc
from src.services.ingestion_service import (
    _extract_transcript_text,
    _filing_date_to_quarter,
    _get_8k_filings,
    _get_exhibit_documents,
    _load_ticker_cik_map,
    ingest_8k_transcripts,
)


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def reset_cik_cache():
    """Wipe the module-level CIK cache before every test."""
    svc._TICKER_CIK_MAP = {}
    yield
    svc._TICKER_CIK_MAP = {}


@pytest.fixture
def mock_client():
    with patch("src.services.ingestion_service.get_client") as mock_factory:
        client = MagicMock()
        client.fetch = AsyncMock()
        mock_factory.return_value = client
        yield client


# ── Task 3 tests: CIK resolution ──────────────────────────────────────────────

async def test_load_ticker_cik_map_returns_zero_padded_cik(mock_client, monkeypatch):
    monkeypatch.setenv("EDGAR_USER_AGENT", "BullByte/1.0 test@example.com")
    mock_client.fetch.return_value = httpx.Response(
        200,
        json={"0": {"cik_str": 1318605, "ticker": "TSLA", "title": "Tesla Inc"}},
    )
    await _load_ticker_cik_map()
    assert svc._TICKER_CIK_MAP["TSLA"] == "0001318605"


async def test_unknown_ticker_raises_value_error(mock_client, monkeypatch):
    monkeypatch.setenv("EDGAR_USER_AGENT", "BullByte/1.0 test@example.com")
    mock_client.fetch.return_value = httpx.Response(
        200,
        json={"0": {"cik_str": 1318605, "ticker": "TSLA", "title": "Tesla Inc"}},
    )
    with pytest.raises(ValueError, match="UNKNOWN"):
        await ingest_8k_transcripts("UNKNOWN", "2024-01-01", "2024-12-31")


# ── Task 4 tests: 8-K filing discovery ───────────────────────────────────────

_SUBMISSIONS_JSON = {
    "cik": "1318605",
    "filings": {
        "recent": {
            "accessionNumber": [
                "0001318605-24-000100",  # 8-K in range
                "0001318605-24-000200",  # 8-K/A — excluded
                "0001318605-23-000300",  # 8-K out of range
                "0001318605-24-000400",  # 8-K in range
            ],
            "filingDate": ["2024-04-15", "2024-05-01", "2023-12-01", "2024-07-20"],
            "form": ["8-K", "8-K/A", "8-K", "8-K"],
        },
        "files": [],
    },
}


async def test_get_8k_filings_filters_correctly(mock_client):
    mock_client.fetch.return_value = httpx.Response(200, json=_SUBMISSIONS_JSON)
    result = await _get_8k_filings("0001318605", "2024-01-01", "2024-12-31")
    accessions = [r["accession_no"] for r in result]
    assert "0001318605-24-000100" in accessions
    assert "0001318605-24-000400" in accessions
    assert "0001318605-24-000200" not in accessions  # 8-K/A
    assert "0001318605-23-000300" not in accessions  # out of range
    assert result == sorted(result, key=lambda x: x["filing_date"])


async def test_get_8k_filings_handles_large_filer_pagination(mock_client):
    page1 = {
        "cik": "320193",
        "filings": {
            "recent": {
                "accessionNumber": ["0000320193-24-000001"],
                "filingDate": ["2024-03-01"],
                "form": ["8-K"],
            },
            "files": [{"name": "CIK0000320193-submissions-001.json"}],
        },
    }
    page2 = {
        "filings": {
            "recent": {
                "accessionNumber": ["0000320193-24-000002"],
                "filingDate": ["2024-06-01"],
                "form": ["8-K"],
            }
        }
    }
    mock_client.fetch.side_effect = [
        httpx.Response(200, json=page1),
        httpx.Response(200, json=page2),
    ]
    result = await _get_8k_filings("0000320193", "2024-01-01", "2024-12-31")
    accessions = [r["accession_no"] for r in result]
    assert "0000320193-24-000001" in accessions
    assert "0000320193-24-000002" in accessions


# ── Task 5 tests: exhibit document extraction ─────────────────────────────────

_INDEX_HTML = textwrap.dedent("""\
    <html><body>
    <table>
      <tr><th>Seq</th><th>Type</th><th>Document</th><th>Type</th><th>Size</th></tr>
      <tr><td>1</td><td>8-K</td><td><a href="/Archives/edgar/data/1318605/000131860524000100/tsla-8k.htm">tsla-8k.htm</a></td><td>8-K</td><td>1000</td></tr>
      <tr><td>2</td><td>EX-99.1</td><td><a href="/Archives/edgar/data/1318605/000131860524000100/ex991.htm">ex991.htm</a></td><td>EX-99.1</td><td>2000</td></tr>
      <tr><td>3</td><td>EX-99.2</td><td><a href="/Archives/edgar/data/1318605/000131860524000100/ex992.htm">ex992.htm</a></td><td>EX-99.2</td><td>3000</td></tr>
    </table>
    </body></html>
""")


async def test_get_exhibit_documents_returns_ex99_docs_with_full_urls(mock_client):
    mock_client.fetch.return_value = httpx.Response(200, text=_INDEX_HTML)
    docs = await _get_exhibit_documents("1318605", "0001318605-24-000100")
    urls = [d["url"] for d in docs]
    assert any("ex991.htm" in u for u in urls)
    assert any("ex992.htm" in u for u in urls)
    assert not any("tsla-8k.htm" in u for u in urls)  # plain 8-K excluded
    for url in urls:
        assert url.startswith("https://www.sec.gov/Archives/edgar/data/1318605/")


# ── Task 6 tests: transcript text extraction ──────────────────────────────────

_NON_TRANSCRIPT_HTML = "<html><body><p>This is a press release about quarterly results.</p></body></html>"

# Score 2: "revenue" + "per share" → PRESS_RELEASE
_PRESS_RELEASE_HTML = "<html><body><p>Revenue for the quarter was $10 billion. Earnings per share were $2.50.</p></body></html>"

_TRANSCRIPT_HTML = textwrap.dedent("""\
    <html><body>
    <p>Operator: Good evening and welcome to the earnings call.</p>
    <p>This conference call contains forward-looking statements.</p>
    <p>Revenue for the fiscal quarter was $25 billion.</p>
    <p>Earnings per share came in at $1.85.</p>
    <p>Q&A session will follow.</p>
    </body></html>
""")


async def test_extract_transcript_text_returns_none_when_low_keyword_score(mock_client):
    mock_client.fetch.return_value = httpx.Response(200, text=_NON_TRANSCRIPT_HTML)
    text, status = await _extract_transcript_text(
        "https://www.sec.gov/Archives/test.htm", "TSLA", "2024-04-15"
    )
    assert text is None
    assert status == "NO_TRANSCRIPT"


async def test_extract_transcript_text_returns_cleaned_text_when_high_keyword_score(mock_client):
    mock_client.fetch.return_value = httpx.Response(200, text=_TRANSCRIPT_HTML)
    text, status = await _extract_transcript_text(
        "https://www.sec.gov/Archives/test.htm", "TSLA", "2024-04-15"
    )
    assert status == "SUCCESS"
    assert text is not None
    assert len(text) > 0
    assert "\n\n\n" not in text  # 3+ blank lines collapsed


async def test_extract_transcript_text_malformed_html_returns_none_no_exception(mock_client):
    mock_client.fetch.return_value = httpx.Response(200, text="<<< not valid html ??? \x00\x01\x02")
    # Should not raise — malformed content either parses with low score or hits except
    text, status = await _extract_transcript_text(
        "https://www.sec.gov/Archives/test.htm", "TSLA", "2024-04-15"
    )
    assert text is None
    assert status in ("NO_TRANSCRIPT", "PARSE_FAILURE")


async def test_low_score_exhibit_returns_press_release(mock_client):
    """Score 1–2 keywords → PRESS_RELEASE with extracted text (story 3.7 AC1)."""
    mock_client.fetch.return_value = httpx.Response(200, text=_PRESS_RELEASE_HTML)
    text, status = await _extract_transcript_text(
        "https://www.sec.gov/Archives/test.htm", "TSLA", "2024-04-15"
    )
    assert status == "PRESS_RELEASE"
    assert text is not None
    assert len(text) > 0


async def test_zero_score_exhibit_returns_no_transcript(mock_client):
    """Score 0 keywords → NO_TRANSCRIPT, unchanged from pre-3.7 behaviour (story 3.7 AC2)."""
    mock_client.fetch.return_value = httpx.Response(200, text=_NON_TRANSCRIPT_HTML)
    text, status = await _extract_transcript_text(
        "https://www.sec.gov/Archives/test.htm", "TSLA", "2024-04-15"
    )
    assert text is None
    assert status == "NO_TRANSCRIPT"


async def test_press_release_persisted_to_cache(mock_client, monkeypatch):
    """PRESS_RELEASE exhibit is persisted and counted in press_releases_extracted (story 3.7 AC3)."""
    from unittest.mock import AsyncMock as _AsyncMock

    tickers_json = {"0": {"cik_str": 1318605, "ticker": "TSLA", "title": "Tesla Inc"}}
    submissions = {
        "cik": "1318605",
        "filings": {
            "recent": {
                "accessionNumber": ["0001318605-24-000001"],
                "filingDate": ["2024-04-15"],
                "form": ["8-K"],
            },
            "files": [],
        },
    }
    mock_client.fetch.side_effect = [
        httpx.Response(200, json=tickers_json),
        httpx.Response(200, json=submissions),
        httpx.Response(200, text=_INDEX_HTML),       # filing index (2 EX-99s)
        httpx.Response(200, text=_PRESS_RELEASE_HTML),  # exhibit 1 → PRESS_RELEASE
        httpx.Response(200, text=_PRESS_RELEASE_HTML),  # exhibit 2 → PRESS_RELEASE (loop continues)
    ]
    insert_mock = _AsyncMock()
    monkeypatch.setattr("src.services.ingestion_service.insert_transcript", insert_mock)

    summary = await ingest_8k_transcripts("TSLA", "2024-01-01", "2024-12-31")

    assert summary.press_releases_extracted == 1
    assert summary.transcripts_extracted == 0
    insert_mock.assert_called_once()
    call_kwargs = insert_mock.call_args.kwargs
    assert call_kwargs["parse_status"] == "PRESS_RELEASE"


async def test_success_beats_press_release(mock_client):
    """First exhibit → PRESS_RELEASE, second → SUCCESS; final result is SUCCESS (story 3.7 AC4)."""
    tickers_json = {"0": {"cik_str": 1318605, "ticker": "TSLA", "title": "Tesla Inc"}}
    submissions = {
        "cik": "1318605",
        "filings": {
            "recent": {
                "accessionNumber": ["0001318605-24-000001"],
                "filingDate": ["2024-04-15"],
                "form": ["8-K"],
            },
            "files": [],
        },
    }
    mock_client.fetch.side_effect = [
        httpx.Response(200, json=tickers_json),
        httpx.Response(200, json=submissions),
        httpx.Response(200, text=_INDEX_HTML),         # filing index (2 EX-99s)
        httpx.Response(200, text=_PRESS_RELEASE_HTML),  # exhibit 1 → PRESS_RELEASE
        httpx.Response(200, text=_TRANSCRIPT_HTML),     # exhibit 2 → SUCCESS → breaks
    ]
    summary = await ingest_8k_transcripts("TSLA", "2024-01-01", "2024-12-31")

    assert summary.transcripts_extracted == 1
    assert summary.press_releases_extracted == 0
    assert summary.results[0].parse_status == "SUCCESS"


# ── Task 7 tests: quarter mapping ────────────────────────────────────────────

@pytest.mark.parametrize("filing_date,expected_quarter", [
    ("2024-01-15", "Q4-2023"),
    ("2024-02-28", "Q4-2023"),
    ("2024-03-31", "Q4-2023"),
    ("2024-04-01", "Q1-2024"),
    ("2024-05-15", "Q1-2024"),
    ("2024-06-30", "Q1-2024"),
    ("2024-07-01", "Q2-2024"),
    ("2024-08-15", "Q2-2024"),
    ("2024-09-30", "Q2-2024"),
    ("2024-10-01", "Q3-2024"),
    ("2024-11-15", "Q3-2024"),
    ("2024-12-31", "Q3-2024"),
])
def test_filing_date_to_quarter_all_months(filing_date, expected_quarter):
    assert _filing_date_to_quarter(filing_date) == expected_quarter


# ── Task 8 tests: orchestrator ────────────────────────────────────────────────

async def test_ingest_8k_transcripts_returns_summary_with_correct_counts(mock_client):
    """Mix of SUCCESS / NO_TRANSCRIPT / FETCH_ERROR filings → counts are accurate."""
    tickers_json = {"0": {"cik_str": 1318605, "ticker": "TSLA", "title": "Tesla Inc"}}
    submissions = {
        "cik": "1318605",
        "filings": {
            "recent": {
                "accessionNumber": ["0001318605-24-000001", "0001318605-24-000002", "0001318605-24-000003"],
                "filingDate": ["2024-04-15", "2024-07-20", "2024-10-22"],
                "form": ["8-K", "8-K", "8-K"],
            },
            "files": [],
        },
    }
    mock_client.fetch.side_effect = [
        httpx.Response(200, json=tickers_json),          # CIK lookup
        httpx.Response(200, json=submissions),            # submissions
        httpx.Response(200, text=_INDEX_HTML),            # filing 1 index (2 EX-99s)
        httpx.Response(200, text=_TRANSCRIPT_HTML),       # filing 1 exhibit 1 (ex991) — SUCCESS → breaks
        httpx.Response(200, text=_INDEX_HTML),            # filing 2 index (2 EX-99s)
        httpx.Response(200, text=_NON_TRANSCRIPT_HTML),   # filing 2 exhibit 1 (ex991) — low score, continues
        httpx.Response(200, text=_NON_TRANSCRIPT_HTML),   # filing 2 exhibit 2 (ex992) — low score, exhausted
        httpx.Response(200, text=_INDEX_HTML),            # filing 3 index (2 EX-99s)
        httpx.Response(200, text=_TRANSCRIPT_HTML),       # filing 3 exhibit 1 (ex991) — SUCCESS → breaks
    ]
    summary = await ingest_8k_transcripts("TSLA", "2024-01-01", "2024-12-31")
    assert summary.ticker == "TSLA"
    assert summary.total_8k_found == 3
    assert summary.transcripts_extracted == 2
    assert summary.skipped_no_transcript == 1
    assert summary.parse_failures == 0
    assert summary.fetch_errors == 0
    assert len(summary.results) == 3


async def test_parse_failure_is_counted_and_does_not_halt_processing(mock_client):
    """PARSE_FAILURE from _extract_transcript_text is counted in parse_failures, not skipped_no_transcript."""
    from unittest.mock import patch as mock_patch

    tickers_json = {"0": {"cik_str": 1318605, "ticker": "TSLA", "title": "Tesla Inc"}}
    submissions = {
        "cik": "1318605",
        "filings": {
            "recent": {
                "accessionNumber": ["0001318605-24-000001", "0001318605-24-000002"],
                "filingDate": ["2024-04-15", "2024-07-20"],
                "form": ["8-K", "8-K"],
            },
            "files": [],
        },
    }
    # patched_extract returns directly for calls 1-2 (no HTTP call) so no responses needed for filing 1 exhibits
    mock_client.fetch.side_effect = [
        httpx.Response(200, json=tickers_json),    # CIK lookup
        httpx.Response(200, json=submissions),      # submissions
        httpx.Response(200, text=_INDEX_HTML),      # filing 1 index
        httpx.Response(200, text=_INDEX_HTML),      # filing 2 index (filing 1 exhibits bypass fetch)
        httpx.Response(200, text=_TRANSCRIPT_HTML), # filing 2 exhibit 1 — original_extract → SUCCESS
    ]

    original_extract = svc._extract_transcript_text
    call_count = {"n": 0}

    async def patched_extract(url, ticker, filing_date):
        call_count["n"] += 1
        if call_count["n"] <= 2:  # first two calls (filing 1 exhibits) → PARSE_FAILURE
            return None, "PARSE_FAILURE"
        return await original_extract(url, ticker, filing_date)

    with mock_patch.object(svc, "_extract_transcript_text", side_effect=patched_extract):
        summary = await ingest_8k_transcripts("TSLA", "2024-01-01", "2024-12-31")

    assert summary.parse_failures == 1
    assert summary.transcripts_extracted == 1
    assert summary.skipped_no_transcript == 0
    statuses = [r.parse_status for r in summary.results]
    assert "PARSE_FAILURE" in statuses
    assert "SUCCESS" in statuses


async def test_edgar_fetch_error_on_one_filing_does_not_halt_processing(mock_client):
    """FETCH_ERROR on filing index should not stop remaining filings."""
    from src.core.edgar_models import EdgarFetchError

    tickers_json = {"0": {"cik_str": 1318605, "ticker": "TSLA", "title": "Tesla Inc"}}
    submissions = {
        "cik": "1318605",
        "filings": {
            "recent": {
                "accessionNumber": ["0001318605-24-000001", "0001318605-24-000002"],
                "filingDate": ["2024-04-15", "2024-07-20"],
                "form": ["8-K", "8-K"],
            },
            "files": [],
        },
    }
    mock_client.fetch.side_effect = [
        httpx.Response(200, json=tickers_json),  # CIK lookup
        httpx.Response(200, json=submissions),   # submissions
        EdgarFetchError(ticker="TSLA", filing_type="filing-index", url="https://x", final_status=404),  # filing 1 → FETCH_ERROR
        httpx.Response(200, text=_INDEX_HTML),   # filing 2 index
        httpx.Response(200, text=_TRANSCRIPT_HTML),  # filing 2 exhibit — SUCCESS
    ]
    summary = await ingest_8k_transcripts("TSLA", "2024-01-01", "2024-12-31")
    assert summary.total_8k_found == 2
    assert summary.transcripts_extracted == 1
    assert summary.fetch_errors == 1
    statuses = [r.parse_status for r in summary.results]
    assert "FETCH_ERROR" in statuses
    assert "SUCCESS" in statuses
