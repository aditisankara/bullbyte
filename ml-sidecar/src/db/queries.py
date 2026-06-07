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
    target_unit: str | None = None,
) -> str:
    """Insert a claim row and return its UUID."""
    pool = await get_pool()
    row_id = str(uuid.uuid4())
    await pool.execute(
        """
        INSERT INTO claims
            (id, company_id, quarter, raw_quote, metric, target_value,
             extraction_confidence, speaker, target_unit)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        """,
        row_id,
        company_id,
        quarter,
        raw_quote,
        metric,
        target_value,
        extraction_confidence,
        speaker,
        target_unit,
        # TODO story 4.x: add claim_type, timeframe columns to claims table
    )
    return row_id


async def insert_claim_batch(claims: list[dict]) -> list[str]:
    """Insert multiple claim rows in a single transaction; return their UUIDs."""
    if not claims:
        return []
    pool = await get_pool()
    row_ids: list[str] = []
    async with pool.acquire() as conn:
        async with conn.transaction():
            for claim in claims:
                row_id = str(uuid.uuid4())
                await conn.execute(
                    """
                    INSERT INTO claims
                        (id, company_id, quarter, raw_quote, metric, target_value,
                         extraction_confidence, speaker, target_unit)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                    """,
                    row_id,
                    claim["company_id"],
                    claim["quarter"],
                    claim["raw_quote"],
                    claim["metric"],
                    claim["target_value"],
                    claim["extraction_confidence"],
                    claim.get("speaker"),
                    claim.get("target_unit"),
                    # TODO story 4.x: add claim_type, timeframe columns to claims table
                )
                row_ids.append(row_id)
    return row_ids


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
        tool_call,
        result_summary,
        edgar_filing_ref,
    )
    return row_id


# ---------------------------------------------------------------------------
# tool_call_logs
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# transcripts (cache)
# ---------------------------------------------------------------------------


async def get_company_id_by_ticker(ticker: str) -> str | None:
    """Return the UUID of the company row for the given ticker, or None if not found."""
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT id FROM companies WHERE ticker = $1",
        ticker,
    )
    return str(row["id"]) if row else None


async def get_all_transcripts_for_ticker(ticker: str) -> list[asyncpg.Record]:
    """Return all transcripts for a ticker with parse_status SUCCESS or PRESS_RELEASE."""
    pool = await get_pool()
    return await pool.fetch(
        """
        SELECT ticker, quarter, filing_date, raw_text, filing_url, parse_status
        FROM transcripts
        WHERE ticker = $1
          AND parse_status IN ('SUCCESS', 'PRESS_RELEASE')
        ORDER BY quarter
        """,
        ticker,
    )


async def get_cached_transcript(ticker: str, quarter: str) -> asyncpg.Record | None:
    """Return cached transcript row for (ticker, quarter), or None if not cached."""
    pool = await get_pool()
    return await pool.fetchrow(
        """
        SELECT ticker, quarter, filing_date, raw_text, filing_url, parse_status
        FROM transcripts
        WHERE ticker = $1 AND quarter = $2
        """,
        ticker,
        quarter,
    )


async def insert_transcript(
    *,
    ticker: str,
    quarter: str,
    filing_date: str,
    raw_text: str,
    filing_url: str,
    parse_status: str,
) -> None:
    """Persist a transcript to the cache. ON CONFLICT (ticker, quarter) DO NOTHING."""
    pool = await get_pool()
    row_id = str(uuid.uuid4())
    await pool.execute(
        """
        INSERT INTO transcripts
            (id, ticker, quarter, filing_date, raw_text, filing_url, parse_status)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (ticker, quarter) DO NOTHING
        """,
        row_id,
        ticker,
        quarter,
        filing_date,
        raw_text,
        filing_url,
        parse_status,
    )


# ---------------------------------------------------------------------------
# financial_actuals (cache)
# ---------------------------------------------------------------------------


async def get_cached_financial_actuals(ticker: str, quarter: str) -> asyncpg.Record | None:
    """Return cached financial_actuals row for (ticker, quarter), or None if not cached."""
    pool = await get_pool()
    return await pool.fetchrow(
        """
        SELECT ticker, quarter, filing_type, status, filing_url, metrics
        FROM financial_actuals
        WHERE ticker = $1 AND quarter = $2
        """,
        ticker,
        quarter,
    )


async def insert_financial_actuals(
    *,
    ticker: str,
    quarter: str,
    filing_type: str,
    status: str,
    filing_url: str,
    metrics_json: str,
) -> None:
    """Persist financial actuals to the cache. ON CONFLICT (ticker, quarter) DO NOTHING.

    metrics_json must be a pre-serialised JSON string:
        json.dumps([m.model_dump() for m in result.metrics])
    asyncpg will cast it to JSONB via the $7::jsonb parameter binding.
    """
    pool = await get_pool()
    row_id = str(uuid.uuid4())
    await pool.execute(
        """
        INSERT INTO financial_actuals
            (id, ticker, quarter, filing_type, status, filing_url, metrics)
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
        ON CONFLICT (ticker, quarter) DO NOTHING
        """,
        row_id,
        ticker,
        quarter,
        filing_type,
        status,
        filing_url,
        metrics_json,
    )


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


# ---------------------------------------------------------------------------
# executives
# ---------------------------------------------------------------------------


async def get_executive_at_date(
    ticker: str,
    role: str,
    date: str,  # 'YYYY-MM-DD'
) -> asyncpg.Record | None:
    """Return the executive holding `role` at `ticker`'s company on `date`, or None.

    Looks up company_id from the companies table, then queries executives
    where start_date <= date AND (end_date IS NULL OR end_date >= date).
    Returns None if the ticker has no matching company row or no executive row.
    """
    pool = await get_pool()
    return await pool.fetchrow(
        """
        SELECT e.id, e.person_name, e.role, e.start_date, e.end_date
        FROM executives e
        JOIN companies c ON c.id = e.company_id
        WHERE c.ticker = $1
          AND e.role = $2
          AND e.start_date <= $3
          AND (e.end_date IS NULL OR e.end_date >= $3)
        ORDER BY e.start_date DESC
        LIMIT 1
        """,
        ticker,
        role,
        date,
    )
