"""asyncpg write helpers for the ML sidecar.

The sidecar is a structured bulk-writer only — it never reads schema
definitions or runs migrations. All table/column names must stay in
sync with api/src/db/schema.ts (the single schema authority).
"""

from __future__ import annotations

import json
import uuid
from decimal import Decimal
from typing import Any

import asyncpg

from .pool import get_pool


# ---------------------------------------------------------------------------
# claims
# ---------------------------------------------------------------------------


async def insert_claim(
    *,
    company_id: str,
    quarter: str,
    raw_quote: str,
    metric: str,
    target_value: str,
    extraction_confidence: Decimal,
    speaker: str | None = None,
) -> str:
    """Insert a claim row and return its UUID."""
    pool = await get_pool()
    row_id = str(uuid.uuid4())
    await pool.execute(
        """
        INSERT INTO claims
            (id, company_id, quarter, raw_quote, metric, target_value,
             extraction_confidence, speaker)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        """,
        row_id,
        company_id,
        quarter,
        raw_quote,
        metric,
        target_value,
        extraction_confidence,
        speaker,
    )
    return row_id


# ---------------------------------------------------------------------------
# verdicts
# ---------------------------------------------------------------------------

VALID_VERDICT_TYPES = frozenset(
    {"DELIVERED", "MISSED", "INSUFFICIENT_DATA", "PENDING", "REVISED"}
)


async def insert_verdict(
    *,
    claim_id: str,
    verdict_type: str,
    delta: str | None = None,
    confidence_score: Decimal | None = None,
    is_correction: bool = False,
    corrects_verdict_id: str | None = None,
) -> str:
    """Insert a verdict row and return its UUID.

    verdict_type must be one of VALID_VERDICT_TYPES (SCREAMING_SNAKE_CASE).
    Verdicts are append-only — no UPDATE path exists.
    """
    if verdict_type not in VALID_VERDICT_TYPES:
        raise ValueError(
            f"Invalid verdict_type '{verdict_type}'. "
            f"Must be one of: {sorted(VALID_VERDICT_TYPES)}"
        )
    if is_correction and corrects_verdict_id is None:
        raise ValueError(
            "corrects_verdict_id must be provided when is_correction=True"
        )
    pool = await get_pool()
    row_id = str(uuid.uuid4())
    await pool.execute(
        """
        INSERT INTO verdicts
            (id, claim_id, verdict_type, delta, confidence_score,
             is_correction, corrects_verdict_id)
        VALUES ($1, $2, $3::verdict_type, $4, $5, $6, $7)
        """,
        row_id,
        claim_id,
        verdict_type,
        delta,
        confidence_score,
        is_correction,
        corrects_verdict_id,
    )
    return row_id


# ---------------------------------------------------------------------------
# reasoning_traces
# ---------------------------------------------------------------------------


async def insert_reasoning_trace(
    *,
    verdict_id: str,
    step_index: int | None = None,
    tool_call: dict[str, Any] | None = None,
    result_summary: str | None = None,
    edgar_filing_ref: str | None = None,
) -> str:
    """Insert a reasoning trace row and return its UUID."""
    pool = await get_pool()
    row_id = str(uuid.uuid4())
    await pool.execute(
        """
        INSERT INTO reasoning_traces
            (id, verdict_id, step_index, tool_call, result_summary, edgar_filing_ref)
        VALUES ($1, $2, $3, $4::jsonb, $5, $6)
        """,
        row_id,
        verdict_id,
        step_index,
        json.dumps(tool_call) if tool_call is not None else None,
        result_summary,
        edgar_filing_ref,
    )
    return row_id


# ---------------------------------------------------------------------------
# tool_call_logs
# ---------------------------------------------------------------------------


async def insert_tool_call_log(
    *,
    job_id: str,
    tool: str,
    input: dict[str, Any],
    output: dict[str, Any] | None = None,
) -> str:
    """Insert a tool call log row and return its UUID."""
    try:
        serialized_input = json.dumps(input)
    except (TypeError, ValueError) as e:
        raise ValueError(f"input is not JSON-serializable: {e}") from e

    pool = await get_pool()
    row_id = str(uuid.uuid4())
    await pool.execute(
        """
        INSERT INTO tool_call_logs (id, job_id, tool, input, output)
        VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
        """,
        row_id,
        job_id,
        tool,
        serialized_input,
        json.dumps(output) if output is not None else None,
    )
    return row_id
