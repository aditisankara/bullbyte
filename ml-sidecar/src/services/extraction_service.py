"""LLM-based numerical claim extraction service (story 4.1).

Imports only from src.core.llm.base — never imports anthropic or openai directly (NFR17).
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone

from src.core.llm.base import LLMResponse, get_provider
from src.core.logging import get_logger
from src.models.claim_models import (
    ClaimType,
    ExtractionError,
    ExtractionResult,
    ExtractedClaim,
)

logger = get_logger("ml-sidecar.extraction_service")

# Pricing constants (best-effort estimates, not billed)
_PRICING: dict[str, tuple[float, float]] = {
    # model: (input_per_1m_usd, output_per_1m_usd)
    "claude-opus-4-5": (15.0, 75.0),
    "claude-opus-4-6": (15.0, 75.0),
    "claude-opus-4-7": (15.0, 75.0),
    "claude-opus-4-8": (15.0, 75.0),
    "claude-sonnet-4-6": (3.0, 15.0),
    "claude-haiku-4-5": (0.25, 1.25),
    "gpt-4o": (5.0, 15.0),
    "gpt-4o-mini": (0.15, 0.60),
    "gpt-4-turbo": (10.0, 30.0),
}

_SYSTEM_PROMPT = """\
You are a financial analyst extracting forward-looking numerical claims from earnings call transcripts.

A forward-looking numerical claim is a statement about a FUTURE metric with a SPECIFIC NUMBER.
Examples: revenue targets, EPS guidance, margin forecasts, unit growth goals, capex plans.

DO NOT extract:
- Historical reported figures (e.g., "Q2 revenue was $117 billion")
- Vague directional statements without numbers (e.g., "we expect growth")
- Safe-harbour boilerplate disclaimers (e.g., "these statements involve risks and uncertainties")

For each forward-looking numerical claim found, output a JSON object with these exact fields:
{
  "raw_quote": "<verbatim sentence(s) from the transcript>",
  "claim_type": "<one of: revenue, earnings, margin, guidance, growth, other>",
  "metric": "<concise metric name, e.g. 'Q3 revenue', 'full-year EPS', 'gross margin'>",
  "target_value": "<the specific number, e.g. '120', '4.50', '28'>",
  "target_unit": "<unit or null, e.g. 'billion USD', 'percent', 'million units'>",
  "timeframe": "<predicted period, e.g. 'Q3 2024', 'FY2025', 'next fiscal year'>",
  "speaker": "<speaker name and title from transcript labels, or null if unclear>",
  "quarter": "<current quarter being reported, e.g. 'Q2-2024' format>"
}

Output ONLY a JSON array of these objects. If there are no forward-looking numerical claims, output an empty array [].
Do not include any explanation or markdown — only the raw JSON array.
"""


def _estimate_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    input_rate, output_rate = _PRICING.get(model, (10.0, 30.0))
    return (input_tokens * input_rate + output_tokens * output_rate) / 1_000_000


def _parse_llm_response(
    response: LLMResponse, quarter: str
) -> tuple[list[ExtractedClaim], list[ExtractionError]]:
    """Parse the LLM JSON response into claims and errors."""
    claims: list[ExtractedClaim] = []
    errors: list[ExtractionError] = []

    if not response.content:
        errors.append(ExtractionError(raw_segment="", error_reason="LLM returned empty response"))
        return claims, errors

    # Strip markdown code fences if present (handles ```json\n...\n``` and ```...\n``` and ```...```)
    text = response.content.strip()
    if text.startswith("```"):
        # Only strip an optional language identifier (word chars), not JSON content
        text = re.sub(r"^```\w*\n?", "", text)
        text = re.sub(r"\n?```\s*$", "", text).strip()

    try:
        raw_list = json.loads(text)
    except json.JSONDecodeError as exc:
        errors.append(
            ExtractionError(raw_segment=text[:500], error_reason=f"JSON parse failed: {exc}")
        )
        return claims, errors

    if not isinstance(raw_list, list):
        errors.append(
            ExtractionError(
                raw_segment=text[:500],
                error_reason="LLM response was not a JSON array",
            )
        )
        return claims, errors

    for item in raw_list:
        if not isinstance(item, dict):
            errors.append(
                ExtractionError(
                    raw_segment=str(item)[:200],
                    error_reason="Claim item is not a JSON object",
                )
            )
            continue
        # Use provided quarter if the LLM omitted it
        if "quarter" not in item or not item["quarter"]:
            item = {**item, "quarter": quarter}
        try:
            claims.append(ExtractedClaim(**item))
        except Exception as exc:
            errors.append(
                ExtractionError(
                    raw_segment=str(item)[:300],
                    error_reason=f"Claim validation failed: {exc}",
                )
            )

    return claims, errors


async def extract_claims(
    transcript_text: str,
    ticker: str,
    quarter: str,
    job_id: str,
) -> ExtractionResult:
    """Extract forward-looking numerical claims from a single transcript.

    Returns an ExtractionResult; failed parses produce ExtractionError entries
    so no claim is silently dropped (AC2).
    """
    provider = get_provider()

    messages = [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {"role": "user", "content": transcript_text},
    ]

    response: LLMResponse = await provider.complete(messages=messages)

    # AC4: emit cost log after every LLM call (formatter injects service + timestamp)
    logger.info(
        "LLM call completed",
        extra={
            "model": response.model,
            "tokens_used": response.input_tokens + response.output_tokens,
            "estimated_cost_usd": _estimate_cost(
                response.model, response.input_tokens, response.output_tokens
            ),
            "ticker": ticker,
            "jobId": job_id,
        },
    )

    claims, errors = _parse_llm_response(response, quarter)

    return ExtractionResult(
        claims=claims,
        errors=errors,
        ticker=ticker,
        quarter=quarter,
    )
