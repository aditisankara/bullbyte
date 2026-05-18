"""OpenAI provider implementation.

Do NOT import this module directly from business logic — use `get_provider()`
from `base.py` instead (NFR17).
"""

from __future__ import annotations

from typing import Any

from openai import AsyncOpenAI

from .base import BaseLLMProvider, LLMResponse

_DEFAULT_MODEL = "gpt-4o"


class OpenAIProvider(BaseLLMProvider):
    def __init__(self, api_key: str, model: str = _DEFAULT_MODEL) -> None:
        self._client = AsyncOpenAI(api_key=api_key)
        self._model = model

    async def complete(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
    ) -> LLMResponse:
        kwargs: dict[str, Any] = {"model": self._model, "messages": messages}
        if tools:
            kwargs["tools"] = [
                {"type": "function", "function": t} for t in tools
            ]

        response = await self._client.chat.completions.create(**kwargs)
        choice = response.choices[0]
        message = choice.message

        content = message.content
        tool_calls: list[dict[str, Any]] = []
        if message.tool_calls:
            tool_calls = [
                {
                    "id": tc.id,
                    "name": tc.function.name,
                    "arguments": tc.function.arguments,
                }
                for tc in message.tool_calls
            ]

        usage = response.usage
        return LLMResponse(
            content=content,
            tool_calls=tool_calls,
            model=response.model,
            input_tokens=usage.prompt_tokens if usage else 0,
            output_tokens=usage.completion_tokens if usage else 0,
        )
