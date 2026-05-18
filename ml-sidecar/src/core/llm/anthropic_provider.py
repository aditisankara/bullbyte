"""Anthropic provider implementation.

Do NOT import this module directly from business logic — use `get_provider()`
from `base.py` instead (NFR17).

Messages are accepted in OpenAI chat format and translated to Anthropic's
format internally so the calling code is provider-agnostic.
"""

from __future__ import annotations

from typing import Any

from anthropic import AsyncAnthropic

from .base import BaseLLMProvider, LLMResponse

_DEFAULT_MODEL = "claude-opus-4-5"


class AnthropicProvider(BaseLLMProvider):
    def __init__(self, api_key: str, model: str = _DEFAULT_MODEL) -> None:
        self._client = AsyncAnthropic(api_key=api_key)
        self._model = model

    async def complete(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
    ) -> LLMResponse:
        system, anthropic_messages = _split_system(messages)
        kwargs: dict[str, Any] = {
            "model": self._model,
            "max_tokens": 4096,
            "messages": anthropic_messages,
        }
        if system:
            kwargs["system"] = system
        if tools:
            kwargs["tools"] = [
                {
                    "name": t["name"],
                    "description": t.get("description", ""),
                    "input_schema": t.get("parameters", {}),
                }
                for t in tools
            ]

        response = await self._client.messages.create(**kwargs)

        content: str | None = None
        tool_calls: list[dict[str, Any]] = []
        for block in response.content:
            if block.type == "text":
                content = (content or "") + block.text
            elif block.type == "tool_use":
                tool_calls.append(
                    {
                        "id": block.id,
                        "name": block.name,
                        "arguments": block.input,
                    }
                )

        return LLMResponse(
            content=content,
            tool_calls=tool_calls,
            model=response.model,
            input_tokens=response.usage.input_tokens,
            output_tokens=response.usage.output_tokens,
        )


def _split_system(
    messages: list[dict[str, Any]],
) -> tuple[str | None, list[dict[str, Any]]]:
    """Extract system prompt and return remaining messages in Anthropic format."""
    system: str | None = None
    rest: list[dict[str, Any]] = []
    for msg in messages:
        if msg["role"] == "system":
            system = msg["content"]
        else:
            rest.append({"role": msg["role"], "content": msg["content"]})
    return system, rest
