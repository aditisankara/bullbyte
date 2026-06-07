"""LLM-powered claim verification service (story 4.3).

Imports only from src.core.llm.base — never imports anthropic or openai directly (NFR17).
All EDGAR fetches route through src.core.edgar_client (NFR10 / rate-limiting).
"""

from __future__ import annotations

import json
import re

from src.core.llm.base import LLMResponse, get_provider
from src.core.logging import get_logger
from src.core.temporal_aligner import align_call_to_actuals
from src.db.queries import insert_verdict
from src.models.verdict_models import VerificationResult
from src.services.financials_service import ingest_financial_actuals

logger = get_logger("ml-sidecar.verification_service")

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

_VERIFICATION_SYSTEM_PROMPT = """\
You are a financial claim verifier. You are given a forward-looking numerical claim from an earnings call and actual reported financial data from a subsequent SEC filing.

Determine if the claim was DELIVERED, MISSED, or if there is INSUFFICIENT_DATA to make a determination.

Definitions:
- DELIVERED: The actual reported value met or exceeded the claimed target (within 2% relative margin, accounting for unit equivalence)
- MISSED: The actual reported value clearly fell short of or exceeded (for a cost target) the claimed threshold
- INSUFFICIENT_DATA: The filing does not contain a clearly matching metric, the metric definitions differ too much, or the data is ambiguous

Output ONLY a JSON object:
{
  "verdict": "DELIVERED" | "MISSED" | "INSUFFICIENT_DATA",
  "reasoning": "<one sentence explaining the verdict and which metric you matched>",
  "matched_metric": "<metric_name from actuals, or null if INSUFFICIENT_DATA>"
}

Do not output markdown, explanations, or anything outside the JSON object.
"""


def _estimate_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    input_rate, output_rate = _PRICING.get(model, (10.0, 30.0))
    return (input_tokens * input_rate + output_tokens * output_rate) / 1_000_000


def _build_verification_prompt(
    claim_metric: str,
    target_value: str,
    target_unit: str | None,
    timeframe: str,
    raw_quote: str,
    actuals_quarter: str,
    filing_type: str,
    metrics: list,
) -> str:
    unit_str = f" {target_unit}" if target_unit else ""
    metrics_lines = "\n".join(
        f"  - {m.metric_name}: {m.value} {m.unit} (source: {m.section_reference}, status: {m.parse_status})"
        for m in metrics
        if m.parse_status in ("SUCCESS", "PARTIAL")
    ) or "  (no metrics available)"
    return (
        f"Claim from earnings call:\n"
        f"  Metric: {claim_metric}\n"
        f"  Claimed value: {target_value}{unit_str}\n"
        f"  Timeframe: {timeframe}\n"
        f"  Original quote: \"{raw_quote}\"\n\n"
        f"Actual reported data from {actuals_quarter} ({filing_type}):\n"
        f"{metrics_lines}"
    )


def _parse_verdict_response(content: str | None) -> str:
    """Return verdict_type string or 'INSUFFICIENT_DATA' on any parse failure."""
    if not content:
        return "INSUFFICIENT_DATA"
    text = content.strip()
    if text.startswith("```"):
        text = re.sub(r"^```\w*\n?", "", text)
        text = re.sub(r"\n?```\s*$", "", text).strip()
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return "INSUFFICIENT_DATA"
    verdict = data.get("verdict", "")
    if verdict not in {"DELIVERED", "MISSED", "INSUFFICIENT_DATA"}:
        return "INSUFFICIENT_DATA"
    return verdict


async def _insufficient_data(
    claim_id: str,
    reason: str,
    actuals_quarter: str,
) -> VerificationResult:
    verdict_id = await insert_verdict(claim_id=claim_id, verdict_type="INSUFFICIENT_DATA")
    return VerificationResult(
        claim_id=claim_id,
        verdict_id=verdict_id,
        verdict_type="INSUFFICIENT_DATA",
        actual_value=None,
        actuals_quarter=actuals_quarter,
        mapping_rationale=reason,
    )


async def verify_claim(
    claim_id: str,
    claim_quarter: str,
    claim_metric: str,
    target_value: str,
    target_unit: str | None,
    ticker: str,
    job_id: str,
    raw_quote: str = "",
    timeframe: str = "",
) -> VerificationResult:
    """Verify a single extracted claim against EDGAR actuals.

    Never raises — all failure paths produce INSUFFICIENT_DATA.
    All EDGAR traffic routes through temporal_aligner / financials_service
    which in turn use edgar_client.get_client() (rate-limited).
    LLM accessed only via get_provider() (NFR17).
    """
    # ── Step 1: Temporal alignment ────────────────────────────────────────────
    decision = await align_call_to_actuals(ticker, claim_quarter)

    if decision.status == "FETCH_ERROR" or not decision.filing_url:
        logger.warning(
            "Temporal alignment failed — producing INSUFFICIENT_DATA",
            extra={
                "ticker": ticker,
                "claim_quarter": claim_quarter,
                "actuals_quarter": decision.actuals_quarter,
                "filing_url": decision.filing_url,
                "failure_reason": decision.mapping_rationale,
                "alignment_status": decision.status,
                "jobId": job_id,
            },
        )
        return await _insufficient_data(
            claim_id=claim_id,
            reason=f"Alignment failed: {decision.mapping_rationale}",
            actuals_quarter=decision.actuals_quarter,
        )

    actuals_quarter = decision.actuals_quarter

    # ── Step 2: Fetch financial actuals ──────────────────────────────────────
    financials = await ingest_financial_actuals(ticker, actuals_quarter)

    if financials.status in ("FETCH_ERROR", "FILING_NOT_YET_AVAILABLE"):
        logger.warning(
            "Financial actuals unavailable — producing INSUFFICIENT_DATA",
            extra={
                "ticker": ticker,
                "actuals_quarter": actuals_quarter,
                "filing_url": financials.filing_url,
                "failure_reason": financials.status,
                "jobId": job_id,
            },
        )
        return await _insufficient_data(
            claim_id=claim_id,
            reason=f"Financials unavailable: {financials.status}",
            actuals_quarter=actuals_quarter,
        )

    # ── Step 3: LLM verdict ──────────────────────────────────────────────────
    user_message = _build_verification_prompt(
        claim_metric=claim_metric,
        target_value=target_value,
        target_unit=target_unit,
        timeframe=timeframe or claim_quarter,
        raw_quote=raw_quote,
        actuals_quarter=actuals_quarter,
        filing_type=financials.filing_type,
        metrics=financials.metrics,
    )

    provider = get_provider()
    messages = [
        {"role": "system", "content": _VERIFICATION_SYSTEM_PROMPT},
        {"role": "user", "content": user_message},
    ]

    response: LLMResponse = await provider.complete(messages=messages)

    # NFR18: emit cost log after every LLM call
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

    verdict_type = _parse_verdict_response(response.content)

    if verdict_type not in {"DELIVERED", "MISSED", "INSUFFICIENT_DATA"}:
        logger.warning(
            "LLM returned invalid verdict — defaulting to INSUFFICIENT_DATA",
            extra={"ticker": ticker, "actuals_quarter": actuals_quarter, "jobId": job_id},
        )
        verdict_type = "INSUFFICIENT_DATA"

    # ── Step 4: Persist verdict ──────────────────────────────────────────────
    verdict_id = await insert_verdict(claim_id=claim_id, verdict_type=verdict_type)

    # Extract actual_value for the best-matched metric (best-effort)
    actual_value: str | None = None
    if financials.metrics:
        matched = next(
            (m for m in financials.metrics if claim_metric.lower() in m.metric_name.lower()),
            None,
        )
        if matched:
            actual_value = matched.value

    return VerificationResult(
        claim_id=claim_id,
        verdict_id=verdict_id,
        verdict_type=verdict_type,
        actual_value=actual_value,
        actuals_quarter=actuals_quarter,
        mapping_rationale=decision.mapping_rationale,
    )
