"""Tests for the EDGAR HTTP client (Story 3.1)."""

import asyncio
import logging
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from src.core.edgar_client import EdgarClient, get_client, reset_client
from src.core.edgar_models import EdgarFetchError


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _ok_response(status_code: int = 200) -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.raise_for_status = MagicMock()  # no-op — success
    resp.text = "ok"
    return resp


def _error_response(status_code: int) -> MagicMock:
    """Mock response whose raise_for_status() raises HTTPStatusError."""
    real_request = httpx.Request("GET", "https://example.com")
    real_response = httpx.Response(status_code, request=real_request)
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.raise_for_status = MagicMock(
        side_effect=httpx.HTTPStatusError(
            f"HTTP {status_code}", request=real_request, response=real_response
        )
    )
    return resp


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
async def _reset():
    """Ensure the singleton and semaphore are fresh before and after each test."""
    reset_client()
    yield
    from src.core import edgar_client as _mod
    if _mod._client is not None:
        await _mod._client._http_client.aclose()
    reset_client()


@pytest.fixture
def user_agent(monkeypatch):
    monkeypatch.setenv("EDGAR_USER_AGENT", "TestApp/1.0 test@example.com")


# ---------------------------------------------------------------------------
# AC1: rate limiter dispatches ≤10 calls/second
# ---------------------------------------------------------------------------

async def test_rate_limiter_dispatches_at_most_10_per_second(user_agent):
    """20 concurrent fetches must take ≥1 second (10-slot token bucket, 1s hold)."""
    client = get_client()
    mock_resp = _ok_response()

    with patch.object(client._http_client, "get", new=AsyncMock(return_value=mock_resp)):
        start = asyncio.get_running_loop().time()
        await asyncio.gather(*[client.fetch(f"https://ex.com/{i}", "AAPL", "8-K") for i in range(20)])
        elapsed = asyncio.get_running_loop().time() - start

    # 20 calls with 10 slots each held 1s → second batch must wait ~1s
    assert elapsed >= 1.0


# ---------------------------------------------------------------------------
# AC2: retry on 429/5xx, raise EdgarFetchError after exhaustion
# ---------------------------------------------------------------------------

async def test_429_exhausts_retries_and_raises_edgar_fetch_error(user_agent):
    """Three consecutive 429 responses → EdgarFetchError with correct fields."""
    client = get_client()

    with patch.object(
        client._http_client,
        "get",
        new=AsyncMock(return_value=_error_response(429)),
    ):
        with pytest.raises(EdgarFetchError) as exc_info:
            await client.fetch("https://efts.sec.gov/test", "TSLA", "10-K")

    err = exc_info.value
    assert err.ticker == "TSLA"
    assert err.filing_type == "10-K"
    assert err.url == "https://efts.sec.gov/test"
    assert err.final_status == 429


async def test_5xx_success_on_second_attempt_returns_response(user_agent):
    """500 on attempt 1, 200 on attempt 2 → returns the response, no exception."""
    client = get_client()

    responses = [_error_response(500), _ok_response(200)]

    with patch.object(
        client._http_client,
        "get",
        new=AsyncMock(side_effect=responses),
    ):
        result = await client.fetch("https://efts.sec.gov/ok", "AAPL", "8-K")

    assert result.status_code == 200


# ---------------------------------------------------------------------------
# AC3: every attempt emits a structured log entry
# ---------------------------------------------------------------------------

async def test_every_attempt_emits_log_entry(user_agent, caplog):
    """Each attempt (including retried failures) must produce exactly one log entry."""
    client = get_client()

    # 3 attempts: 429, 429, 200
    responses = [_error_response(429), _error_response(429), _ok_response(200)]

    with caplog.at_level(logging.INFO, logger="ml-sidecar.edgar_client"):
        with patch.object(
            client._http_client,
            "get",
            new=AsyncMock(side_effect=responses),
        ):
            await client.fetch("https://efts.sec.gov/log", "MSFT", "8-K")

    assert len(caplog.records) == 3
    for i, record in enumerate(caplog.records, start=1):
        assert record.ticker == "MSFT"  # type: ignore[attr-defined]
        assert record.filing_type == "8-K"  # type: ignore[attr-defined]
        assert record.attempt_number == i  # type: ignore[attr-defined]


async def test_failed_exhausted_retries_still_emit_log_entries(user_agent, caplog):
    """3 exhausted 429 attempts each emit a log entry before EdgarFetchError is raised."""
    client = get_client()

    with caplog.at_level(logging.INFO, logger="ml-sidecar.edgar_client"):
        with patch.object(
            client._http_client,
            "get",
            new=AsyncMock(return_value=_error_response(429)),
        ):
            with pytest.raises(EdgarFetchError):
                await client.fetch("https://efts.sec.gov/fail", "GOOG", "10-Q")

    assert len(caplog.records) == 3


# ---------------------------------------------------------------------------
# AC4: User-Agent header is set on every request
# ---------------------------------------------------------------------------

async def test_user_agent_header_is_set_on_every_request(monkeypatch):
    """User-Agent header must equal the EDGAR_USER_AGENT env var value."""
    monkeypatch.setenv("EDGAR_USER_AGENT", "BullByte/1.0 contact@example.com")
    client = get_client()

    captured_headers: list[httpx.Headers] = []

    async def _capture(url, **kwargs):
        captured_headers.append(client._http_client.headers)
        return _ok_response()

    with patch.object(client._http_client, "get", new=AsyncMock(side_effect=_capture)):
        await client.fetch("https://efts.sec.gov/", "NVDA", "8-K")

    assert len(captured_headers) == 1
    assert captured_headers[0]["user-agent"] == "BullByte/1.0 contact@example.com"


def test_missing_user_agent_env_var_raises_value_error(monkeypatch):
    """EdgarClient.__init__ must raise ValueError when EDGAR_USER_AGENT is unset."""
    monkeypatch.delenv("EDGAR_USER_AGENT", raising=False)
    with pytest.raises(ValueError, match="EDGAR_USER_AGENT"):
        EdgarClient(user_agent="")


def test_whitespace_only_user_agent_raises_value_error():
    """Whitespace-only user agent must be rejected (would produce invalid User-Agent header)."""
    with pytest.raises(ValueError, match="EDGAR_USER_AGENT"):
        EdgarClient(user_agent="   ")


def test_get_client_raises_when_user_agent_missing(monkeypatch):
    """get_client() propagates ValueError from EdgarClient when env var is absent."""
    monkeypatch.delenv("EDGAR_USER_AGENT", raising=False)
    with pytest.raises(ValueError, match="EDGAR_USER_AGENT"):
        get_client()


# ---------------------------------------------------------------------------
# Additional coverage
# ---------------------------------------------------------------------------

async def test_2xx_returns_on_first_attempt_no_retry(user_agent, caplog):
    """200 response is returned immediately with a single log entry."""
    client = get_client()

    mock_get = AsyncMock(return_value=_ok_response(200))
    with caplog.at_level(logging.INFO, logger="ml-sidecar.edgar_client"):
        with patch.object(client._http_client, "get", new=mock_get):
            result = await client.fetch("https://efts.sec.gov/200", "AMZN", "10-K")

    assert result.status_code == 200
    assert mock_get.call_count == 1
    assert len(caplog.records) == 1


def test_get_client_returns_singleton(user_agent):
    """get_client() returns the same instance on repeated calls."""
    c1 = get_client()
    c2 = get_client()
    assert c1 is c2


async def test_non_retried_4xx_raises_edgar_fetch_error(user_agent):
    """Non-retried 4xx (e.g. 404) must be wrapped as EdgarFetchError for a consistent error contract."""
    client = get_client()

    with patch.object(
        client._http_client,
        "get",
        new=AsyncMock(return_value=_error_response(404)),
    ):
        with pytest.raises(EdgarFetchError) as exc_info:
            await client.fetch("https://efts.sec.gov/missing", "AAPL", "8-K")

    assert exc_info.value.final_status == 404
    assert exc_info.value.ticker == "AAPL"
