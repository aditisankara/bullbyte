"""LLM-powered claim verification service (story 4.3).

Imports only from src.core.llm.base — never imports anthropic or openai directly (NFR17).
All EDGAR fetches route through src.core.edgar_client (NFR10 / rate-limiting).
"""

from __future__ import annotations

import json
import re
from decimal import Decimal

from src.core.llm.base import LLMResponse, get_provider
from src.core.logging import get_logger
from src.core.temporal_aligner import align_call_to_actuals
from src.db.queries import insert_reasoning_trace, insert_verdict
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


def _parse_full_verdict_response(content: str | None) -> tuple[str, str | None, str]:
    """Return (verdict_type, matched_metric_name, reasoning). Never raises."""
    if not content:
        return "INSUFFICIENT_DATA", None, ""
    text = content.strip()
    if text.startswith("```"):
        text = re.sub(r"^```\w*\n?", "", text)
        text = re.sub(r"\n?```\s*$", "", text).strip()
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return "INSUFFICIENT_DATA", None, ""
    verdict = data.get("verdict", "")
    if verdict not in {"DELIVERED", "MISSED", "INSUFFICIENT_DATA"}:
        verdict = "INSUFFICIENT_DATA"
    return verdict, data.get("matched_metric"), data.get("reasoning", "")


def _parse_numeric_value(value_str: str, unit_str: str | None) -> tuple[float, str] | None:
    """Return (normalized_float, base_unit_tag) or None if value cannot be parsed.

    Normalizes common financial scale words to raw numbers:
      "billion" / "B"  → multiply by 1e9, tag "currency"
      "million" / "M"  → multiply by 1e6, tag "currency"
      "trillion" / "T" → multiply by 1e12, tag "currency"
      "%" / "percent"  → tag "percent" (no multiplier applied)
      otherwise        → tag "raw"
    """
    try:
        cleaned = value_str.strip().replace(",", "").replace("$", "").replace("%", "")
        num = float(cleaned)
    except (ValueError, TypeError, AttributeError):
        return None

    unit = (unit_str or "").lower()
    if "billion" in unit or (unit.endswith("b") and len(unit) <= 3):
        return (num * 1_000_000_000.0, "currency")
    if "million" in unit or (unit in {"m", "mm", "usd m", "$ m"}):
        return (num * 1_000_000.0, "currency")
    if "trillion" in unit or (unit.endswith("t") and len(unit) <= 3):
        return (num * 1_000_000_000_000.0, "currency")
    if "%" in (unit_str or "") or "percent" in unit:
        return (num, "percent")
    return (num, "raw")


def _compute_delta(
    target_value: str,
    target_unit: str | None,
    actual_value: str | None,
    actual_unit: str | None,
) -> tuple[str | None, bool]:
    """Compute signed delta = actual - target.

    Returns (delta_str, is_unit_conflict).
    - delta_str: signed string (e.g. "3000000000.0") or None
    - is_unit_conflict: True means caller must produce INSUFFICIENT_DATA
    """
    if actual_value is None:
        return None, False  # No actual available — not a conflict

    parsed_target = _parse_numeric_value(target_value, target_unit)
    parsed_actual = _parse_numeric_value(actual_value, actual_unit)

    if parsed_target is None or parsed_actual is None:
        return None, False  # Unparseable — don't crash, just omit delta

    target_num, target_tag = parsed_target
    actual_num, actual_tag = parsed_actual

    # Incompatible unit families (e.g. percent vs currency/raw)
    meaningful = {"currency", "percent"}
    if target_tag in meaningful and actual_tag in meaningful and target_tag != actual_tag:
        return None, True  # Unit conflict

    delta = actual_num - target_num
    return str(delta), False


def _compute_confidence(
    matched_metric: str | None,
    claim_metric: str,
    verdict_type: str,
    best_metric_status: str | None,
) -> Decimal:
    """Compute confidence score (0–1) for the verdict.

    High (≥0.80):  clear metric name overlap + SUCCESS parse_status
    Medium (0.40–0.79): inferred match or PARTIAL parse_status
    Low (≤0.30):   INSUFFICIENT_DATA or no metric matched
    """
    if verdict_type == "INSUFFICIENT_DATA":
        return Decimal("0.20")

    if matched_metric is None:
        return Decimal("0.30")

    m_lower = matched_metric.lower()
    c_lower = claim_metric.lower()
    is_direct_match = c_lower in m_lower or m_lower in c_lower

    if is_direct_match:
        return Decimal("0.90") if best_metric_status == "SUCCESS" else Decimal("0.70")
    else:
        return Decimal("0.60") if best_metric_status == "SUCCESS" else Decimal("0.45")


async def _insufficient_data(
    claim_id: str,
    reason: str,
    actuals_quarter: str,
    confidence_score: Decimal = Decimal("0.20"),
) -> VerificationResult:
    verdict_id = await insert_verdict(
        claim_id=claim_id,
        verdict_type="INSUFFICIENT_DATA",
        confidence_score=confidence_score,
    )
    return VerificationResult(
        claim_id=claim_id,
        verdict_id=verdict_id,
        verdict_type="INSUFFICIENT_DATA",
        actual_value=None,
        actuals_quarter=actuals_quarter,
        mapping_rationale=reason,
        delta=None,
        confidence_score=float(confidence_score),
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

    # ── Step 3 (continued): Parse full LLM response ───────────────────────────
    verdict_type, matched_metric_name, _reasoning = _parse_full_verdict_response(response.content)

    if verdict_type not in {"DELIVERED", "MISSED", "INSUFFICIENT_DATA"}:
        logger.warning(
            "LLM returned invalid verdict — defaulting to INSUFFICIENT_DATA",
            extra={"ticker": ticker, "actuals_quarter": actuals_quarter, "jobId": job_id},
        )
        verdict_type = "INSUFFICIENT_DATA"

    # ── Step 4: Find actual metric value ─────────────────────────────────────
    actual_value: str | None = None
    actual_unit: str | None = None
    best_metric_status: str | None = None

    if financials.metrics:
        # Prefer the metric the LLM named; fall back to name-based search
        candidates = financials.metrics
        matched_m = None
        if matched_metric_name:
            matched_m = next(
                (m for m in candidates if matched_metric_name.lower() in m.metric_name.lower()),
                None,
            )
        if matched_m is None:
            matched_m = next(
                (m for m in candidates if claim_metric.lower() in m.metric_name.lower()),
                None,
            )
        if matched_m is not None:
            actual_value = matched_m.value
            actual_unit = matched_m.unit
            best_metric_status = matched_m.parse_status

    # ── Step 5: Compute delta ─────────────────────────────────────────────────
    delta: str | None = None
    normalization_needed = False

    if verdict_type != "INSUFFICIENT_DATA":
        delta, is_unit_conflict = _compute_delta(
            target_value, target_unit, actual_value, actual_unit
        )
        if is_unit_conflict:
            logger.warning(
                "Unit conflict during delta calculation — upgrading to INSUFFICIENT_DATA",
                extra={
                    "ticker": ticker,
                    "claim_metric": claim_metric,
                    "target_unit": target_unit,
                    "actual_unit": actual_unit,
                    "jobId": job_id,
                },
            )
            return await _insufficient_data(
                claim_id=claim_id,
                reason=f"Unit conflict: cannot normalize {target_unit!r} to {actual_unit!r}",
                actuals_quarter=actuals_quarter,
            )
        # Flag if units differed so we log a normalization trace step after insert
        if (
            delta is not None
            and target_unit
            and actual_unit
            and target_unit.lower() != actual_unit.lower()
        ):
            normalization_needed = True

    # ── Step 6: Compute confidence score ─────────────────────────────────────
    confidence_score = _compute_confidence(
        matched_metric_name, claim_metric, verdict_type, best_metric_status
    )

    # ── Step 7: Persist verdict with delta and confidence ─────────────────────
    verdict_id = await insert_verdict(
        claim_id=claim_id,
        verdict_type=verdict_type,
        delta=delta,
        confidence_score=confidence_score,
    )

    # ── Step 8: Log normalization trace when units were converted ─────────────
    if normalization_needed:
        await insert_reasoning_trace(
            verdict_id=verdict_id,
            step_index=1,
            tool_call={
                "action": "unit_normalization",
                "claim_metric": claim_metric,
                "target_value": target_value,
                "target_unit": target_unit,
                "actual_value": actual_value,
                "actual_unit": actual_unit,
                "delta": delta,
            },
            result_summary=(
                f"Normalized units before delta: "
                f"target={target_value} ({target_unit}), "
                f"actual={actual_value} ({actual_unit}), "
                f"delta={delta}"
            ),
            edgar_filing_ref=None,
        )

    return VerificationResult(
        claim_id=claim_id,
        verdict_id=verdict_id,
        verdict_type=verdict_type,
        actual_value=actual_value,
        actuals_quarter=actuals_quarter,
        mapping_rationale=decision.mapping_rationale,
        delta=delta,
        confidence_score=float(confidence_score),
    )
