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
    BoilerplateSegment,
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

DO NOT include in claims:
- Historical reported figures (e.g., "Q2 revenue was $117 billion")
- Vague directional statements without numbers (e.g., "we expect growth")
- Safe-harbour boilerplate disclaimers — put those in the "boilerplate" array instead

Output ONLY a JSON object with exactly two keys:
{
  "claims": [ ...array of claim objects... ],
  "boilerplate": [ ...array of skipped boilerplate passages... ]
}

Each claim object:
{
  "raw_quote": "<verbatim sentence(s) from the transcript>",
  "claim_type": "<one of: revenue, earnings, margin, guidance, growth, other>",
  "metric": "<concise metric name, e.g. 'Q3 revenue', 'full-year EPS', 'gross margin'>",
  "target_value": "<the specific number, e.g. '120', '4.50', '28'>",
  "target_unit": "<unit or null, e.g. 'billion USD', 'percent', 'million units'>",
  "timeframe": "<predicted period, e.g. 'Q3 2024', 'FY2025', 'next fiscal year'>",
  "speaker": "<speaker name and title from transcript labels, or null if unclear>",
  "quarter": "<current quarter being reported, e.g. 'Q2-2024' format>",
  "extraction_confidence": <float 0.0–1.0>
}

Confidence scoring rules:
- 0.80–1.00: Explicitly stated specific number, no hedging language ("We expect", "We guide to", "We will deliver")
- 0.60–0.79: Moderately certain ("We anticipate", "approximately X", clear context)
- 0.00–0.59: Hedged or uncertain ("could be", "we think", "somewhere around", conditional language)

Each boilerplate entry:
{
  "raw_segment": "<the boilerplate text>",
  "reason": "safe_harbour_boilerplate"
}

Do not output markdown, explanations, or anything outside the JSON object.
"""


def _estimate_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    input_rate, output_rate = _PRICING.get(model, (10.0, 30.0))
    return (input_tokens * input_rate + output_tokens * output_rate) / 1_000_000


def _parse_llm_response(
    response: LLMResponse,
    quarter: str,
    ticker: str,
    job_id: str,
) -> tuple[list[ExtractedClaim], list[ExtractionError], list[BoilerplateSegment]]:
    """Parse the LLM JSON response into claims, errors, and boilerplate segments."""
    claims: list[ExtractedClaim] = []
    errors: list[ExtractionError] = []
    boilerplate: list[BoilerplateSegment] = []

    if not response.content:
        errors.append(ExtractionError(raw_segment="", error_reason="LLM returned empty response"))
        return claims, errors, boilerplate

    # Strip markdown code fences if present (handles ```json\n...\n``` and ```...\n``` and ```...```)
    text = response.content.strip()
    if text.startswith("```"):
        # Only strip an optional language identifier (word chars), not JSON content
        text = re.sub(r"^```\w*\n?", "", text)
        text = re.sub(r"\n?```\s*$", "", text).strip()

    try:
        raw_data = json.loads(text)
    except json.JSONDecodeError as exc:
        errors.append(
            ExtractionError(raw_segment=text[:500], error_reason=f"JSON parse failed: {exc}")
        )
        return claims, errors, boilerplate

    if not isinstance(raw_data, dict):
        errors.append(
            ExtractionError(
                raw_segment=text[:500],
                error_reason="LLM response was not a JSON object",
            )
        )
        return claims, errors, boilerplate

    claim_list = raw_data.get("claims", [])
    boilerplate_raw = raw_data.get("boilerplate", [])

    if not isinstance(claim_list, list):
        errors.append(
            ExtractionError(
                raw_segment=text[:500],
                error_reason="LLM response 'claims' field is not an array",
            )
        )
        return claims, errors, boilerplate

    if not isinstance(boilerplate_raw, list):
        logger.debug(
            "LLM response 'boilerplate' field is not an array — treating as empty",
            extra={"ticker": ticker, "quarter": quarter, "jobId": job_id},
        )
        boilerplate_raw = []

    for item in claim_list:
        if not isinstance(item, dict):
            errors.append(
                ExtractionError(
                    raw_segment=str(item)[:200],
                    error_reason="Claim item is not a JSON object",
                )
            )
            continue
        # Use provided quarter if LLM omitted it or returned a malformatted value
        q = item.get("quarter", "")
        if not q or not re.match(r"^Q[1-4]-\d{4}$", str(q)):
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

    for item in boilerplate_raw:
        if not isinstance(item, dict):
            logger.debug(
                "Skipping non-dict boilerplate entry",
                extra={"entry": str(item)[:100], "ticker": ticker, "quarter": quarter, "jobId": job_id},
            )
            continue
        try:
            seg = BoilerplateSegment(**item)
            boilerplate.append(seg)
            logger.warning(
                "Safe-harbour boilerplate filtered",
                extra={
                    "raw_segment": seg.raw_segment[:300],
                    "reason": seg.reason,
                    "ticker": ticker,
                    "quarter": quarter,
                    "jobId": job_id,
                },
            )
        except Exception as exc:
            logger.debug(
                "Skipping malformed boilerplate entry",
                extra={"entry": str(item)[:100], "error": str(exc), "ticker": ticker, "quarter": quarter, "jobId": job_id},
            )

    return claims, errors, boilerplate


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

    claims, errors, boilerplate = _parse_llm_response(response, quarter, ticker, job_id)

    return ExtractionResult(
        claims=claims,
        errors=errors,
        boilerplate_segments=boilerplate,
        ticker=ticker,
        quarter=quarter,
    )
