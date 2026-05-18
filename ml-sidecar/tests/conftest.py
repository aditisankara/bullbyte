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
