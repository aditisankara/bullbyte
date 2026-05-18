"""Tests for the LLM provider factory (AC3)."""

import pytest

from src.core.llm.base import get_provider, reset_provider
from src.core.llm.openai_provider import OpenAIProvider
from src.core.llm.anthropic_provider import AnthropicProvider


@pytest.fixture(autouse=True)
def _reset():
    """Ensure singleton is cleared between tests."""
    reset_provider()
    yield
    reset_provider()


def test_factory_returns_openai_provider(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    provider = get_provider()
    assert isinstance(provider, OpenAIProvider)


def test_factory_returns_anthropic_provider(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "anthropic")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
    provider = get_provider()
    assert isinstance(provider, AnthropicProvider)


def test_factory_caches_singleton(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    p1 = get_provider()
    p2 = get_provider()
    assert p1 is p2


def test_factory_raises_on_unknown_provider(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "unknown_provider")
    with pytest.raises(ValueError, match="Unknown LLM_PROVIDER"):
        get_provider()


def test_factory_raises_when_openai_key_missing(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    with pytest.raises(ValueError, match="OPENAI_API_KEY"):
        get_provider()


def test_factory_raises_when_anthropic_key_missing(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "anthropic")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    with pytest.raises(ValueError, match="ANTHROPIC_API_KEY"):
        get_provider()


def test_provider_interface_has_complete_method(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    provider = get_provider()
    assert callable(getattr(provider, "complete", None))
