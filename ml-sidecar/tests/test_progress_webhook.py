"""Tests for the FastAPI -> NestJS progress webhook client (story 5.3)."""

import httpx
import pytest

from src.core import progress_webhook
from src.models.progress_models import ProgressEvent


def _event() -> ProgressEvent:
    return ProgressEvent(
        event="transcript-fetched",
        jobId="job-123",
        stepIndex=1,
        totalSteps=5,
        message="Fetched 8-K transcript",
        timestamp="2026-05-29T00:00:00.000Z",
    )


@pytest.fixture
def _webhook_env(monkeypatch):
    monkeypatch.setenv("NESTJS_WEBHOOK_URL", "http://api:3000/internal")
    monkeypatch.setenv("INTERNAL_WEBHOOK_SECRET", "test-secret")


@pytest.mark.asyncio
async def test_posts_camelcase_payload_to_correct_url(monkeypatch, _webhook_env):
    calls = {}

    async def fake_post(self, url, json=None, headers=None):
        calls["url"] = url
        calls["json"] = json
        calls["headers"] = headers
        return httpx.Response(202)

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)

    await progress_webhook.emit_progress(_event())

    # URL derives jobId from the event, not a hardcoded value (NFR12 / AC).
    assert calls["url"] == "http://api:3000/internal/jobs/job-123/progress"
    # Shared-secret header matches the NestJS guard.
    assert calls["headers"]["X-Internal-Token"] == "test-secret"
    # Wire shape is camelCase and identical to the SSE contract (no transformation).
    assert calls["json"] == {
        "event": "transcript-fetched",
        "jobId": "job-123",
        "stepIndex": 1,
        "totalSteps": 5,
        "message": "Fetched 8-K transcript",
        "timestamp": "2026-05-29T00:00:00.000Z",
    }


@pytest.mark.asyncio
async def test_transport_error_is_swallowed(monkeypatch, _webhook_env):
    async def boom(self, url, json=None, headers=None):
        raise httpx.ConnectError("nestjs down")

    monkeypatch.setattr(httpx.AsyncClient, "post", boom)

    # AC3: a webhook failure must never interrupt the analysis run.
    await progress_webhook.emit_progress(_event())


@pytest.mark.asyncio
async def test_missing_url_is_a_noop(monkeypatch):
    monkeypatch.delenv("NESTJS_WEBHOOK_URL", raising=False)

    async def fail(self, url, json=None, headers=None):  # pragma: no cover
        raise AssertionError("should not POST without NESTJS_WEBHOOK_URL")

    monkeypatch.setattr(httpx.AsyncClient, "post", fail)

    await progress_webhook.emit_progress(_event())
