"""LLM provider abstraction layer.

`BaseLLMProvider` is the only interface the rest of the codebase imports.
Concrete provider modules (`openai_provider`, `anthropic_provider`) are
imported ONLY inside `get_provider()` — no other file may import them
directly (NFR17).
"""

from __future__ import annotations

import os
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


@dataclass
class LLMResponse:
    content: str | None
    tool_calls: list[dict[str, Any]]
    model: str
    input_tokens: int
    output_tokens: int = 0


class BaseLLMProvider(ABC):
    @abstractmethod
    async def complete(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
    ) -> LLMResponse:
        """Send messages to the LLM and return a structured response.

        Args:
            messages: List of message dicts in OpenAI chat format
                      ({"role": "user"|"assistant"|"system", "content": "..."}).
            tools: Optional list of tool definitions in OpenAI function format
                   ({"name": "...", "description": "...", "parameters": {...}}).
                   Provider implementations translate to their own wire format.

        Returns:
            LLMResponse with content text, any tool calls, model name, and token counts.
        """


_provider: BaseLLMProvider | None = None


def get_provider() -> BaseLLMProvider:
    """Return the cached LLM provider singleton.

    Reads `LLM_PROVIDER` env var ("openai" or "anthropic") and instantiates
    the matching provider exactly once. No other module should import provider
    classes directly (NFR17).
    """
    global _provider
    if _provider is None:
        _provider = _create_provider()
    return _provider


def _create_provider() -> BaseLLMProvider:
    name = os.environ.get("LLM_PROVIDER", "openai").lower()
    if name == "openai":
        from .openai_provider import OpenAIProvider  # noqa: PLC0415

        api_key = os.environ.get("OPENAI_API_KEY", "")
        if not api_key:
            raise ValueError("OPENAI_API_KEY is required when LLM_PROVIDER=openai")
        return OpenAIProvider(api_key=api_key)
    if name == "anthropic":
        from .anthropic_provider import AnthropicProvider  # noqa: PLC0415

        api_key = os.environ.get("ANTHROPIC_API_KEY", "")
        if not api_key:
            raise ValueError("ANTHROPIC_API_KEY is required when LLM_PROVIDER=anthropic")
        return AnthropicProvider(api_key=api_key)
    raise ValueError(
        f"Unknown LLM_PROVIDER: {name!r}. Supported values: 'openai', 'anthropic'."
    )


def reset_provider() -> None:
    """Reset the cached provider (test helper — not for production use)."""
    global _provider
    _provider = None
