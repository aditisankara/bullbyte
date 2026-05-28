import os
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    """Set required env vars for every test so no real API keys are needed."""
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setenv("DATABASE_URL", "postgresql://test:test@localhost/test")


@pytest.fixture(autouse=True)
def _mock_db_cache(monkeypatch):
    """Default all DB cache helpers to cache-miss + noop-insert for every test.

    Prevents unit tests from attempting real asyncpg connections. Tests that
    need specific cache behaviour override these mocks with patch() themselves.
    """
    monkeypatch.setattr(
        "src.services.ingestion_service.get_cached_transcript",
        AsyncMock(return_value=None),
    )
    monkeypatch.setattr(
        "src.services.ingestion_service.insert_transcript",
        AsyncMock(),
    )
    monkeypatch.setattr(
        "src.services.financials_service.get_cached_financial_actuals",
        AsyncMock(return_value=None),
    )
    monkeypatch.setattr(
        "src.services.financials_service.insert_financial_actuals",
        AsyncMock(),
    )


@pytest.fixture(autouse=True)
def _reset_lock_registries():
    """Clear per-(ticker, quarter) asyncio lock dicts before and after each test.

    asyncio.Lock objects are bound to the event loop they were first awaited in.
    pytest-asyncio creates a fresh event loop per test, so stale locks from a
    previous test must be cleared to prevent 'Future attached to a different
    loop' errors.
    """
    import src.services.ingestion_service as ingestion_svc
    import src.services.financials_service as financials_svc

    ingestion_svc._TICKER_CIK_MAP = {}
    ingestion_svc._TRANSCRIPT_CACHE_LOCKS = {}
    financials_svc._FINANCIALS_CACHE_LOCKS = {}
    yield
    ingestion_svc._TICKER_CIK_MAP = {}
    ingestion_svc._TRANSCRIPT_CACHE_LOCKS = {}
    financials_svc._FINANCIALS_CACHE_LOCKS = {}


@pytest.fixture
def client(monkeypatch):
    """Return a TestClient with DB pool mocked out (no live Postgres needed)."""
    mock_pool = MagicMock()

    async def _mock_get_pool():
        return mock_pool

    async def _mock_close_pool():
        pass

    monkeypatch.setattr("src.db.pool.get_pool", _mock_get_pool)
    monkeypatch.setattr("src.db.pool.close_pool", _mock_close_pool)
    monkeypatch.setattr("src.main.get_pool", _mock_get_pool)
    monkeypatch.setattr("src.main.close_pool", _mock_close_pool)

    from src.main import app

    with TestClient(app, raise_server_exceptions=False) as c:
        yield c
