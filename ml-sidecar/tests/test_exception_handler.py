"""Tests for global exception handlers (AC5)."""

import pytest
from fastapi import HTTPException


def test_http_exception_returns_standard_shape(client):
    from src.main import app

    @app.get("/test-http-exc")
    async def _raise():
        raise HTTPException(status_code=418, detail="I'm a teapot")

    try:
        response = client.get("/test-http-exc")
        assert response.status_code == 418
        data = response.json()
        assert "detail" in data
        assert "code" in data["detail"]
        assert "message" in data["detail"]
        assert data["detail"]["message"] == "I'm a teapot"
    finally:
        app.routes[:] = [r for r in app.routes if getattr(r, "path", "") != "/test-http-exc"]


def test_http_exception_does_not_expose_stack_trace(client):
    from src.main import app

    @app.get("/test-http-exc-trace")
    async def _raise():
        raise HTTPException(status_code=403, detail="Forbidden")

    try:
        response = client.get("/test-http-exc-trace")
        assert "Traceback" not in response.text
        assert 'File "' not in response.text
    finally:
        app.routes[:] = [r for r in app.routes if getattr(r, "path", "") != "/test-http-exc-trace"]


def test_generic_exception_returns_standard_shape(client, monkeypatch):
    from src.main import app

    @app.get("/test-raise-generic")
    async def _raise():
        raise RuntimeError("boom")

    try:
        response = client.get("/test-raise-generic")
        assert response.status_code == 500
        data = response.json()
        assert data == {
            "detail": {"code": "INTERNAL_ERROR", "message": "An unexpected error occurred"}
        }
    finally:
        app.routes[:] = [r for r in app.routes if getattr(r, "path", "") != "/test-raise-generic"]


def test_generic_exception_does_not_expose_error_detail(client, monkeypatch):
    from src.main import app

    @app.get("/test-raise-leak")
    async def _raise():
        raise RuntimeError("secret internal message")

    try:
        response = client.get("/test-raise-leak")
        assert "secret internal message" not in response.text
        assert "RuntimeError" not in response.text
        assert "Traceback" not in response.text
    finally:
        app.routes[:] = [r for r in app.routes if getattr(r, "path", "") != "/test-raise-leak"]


def test_404_returns_standard_shape(client):
    response = client.get("/nonexistent-route-xyz-abc")
    assert response.status_code == 404
    data = response.json()
    assert "detail" in data
