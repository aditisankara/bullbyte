"""Analysis router — LLM-based claim extraction pipeline (story 4.1)."""

from __future__ import annotations

from datetime import datetime, timezone, timedelta
from decimal import Decimal

from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from src.core.logging import get_logger
from src.core.progress_webhook import emit_progress
from src.db.queries import (
    get_all_transcripts_for_ticker,
    get_company_id_by_ticker,
    get_existing_claim_keys,
    get_pending_claims_for_ticker,
    insert_claim_batch,
    set_company_name_if_placeholder,
)
from src.models.progress_models import ProgressEvent
from src.services.extraction_service import extract_claims
from src.services.ingestion_service import ingest_8k_transcripts, resolve_company_name
from src.services.verification_service import verify_claim

# 8 quarters of earnings calls
_INGEST_LOOKBACK_DAYS = 730

router = APIRouter()
logger = get_logger("ml-sidecar.analysis_router")


class AnalyzeRequest(BaseModel):
    jobId: str


async def _run_extraction(ticker: str, job_id: str) -> None:
    """Background extraction task: fetch transcripts → extract claims → persist."""
    try:
        await _do_extraction(ticker, job_id)
    except Exception:
        logger.exception(
            "Unhandled error in extraction background task",
            extra={"ticker": ticker, "jobId": job_id},
        )
        await emit_progress(
            ProgressEvent(
                event="analysis-failed",
                jobId=job_id,
                stepIndex=0,
                totalSteps=1,
                message=f"Unexpected error during claim extraction for {ticker}",
                timestamp=datetime.now(timezone.utc).isoformat(),
            )
        )


async def _reverify_pending_claims(ticker: str, job_id: str) -> None:
    """Give claims that were PENDING (filing not yet published) another verification pass.

    Verdicts are append-only, so a claim whose filing has since landed simply gets a
    newer DELIVERED / MISSED / INSUFFICIENT_DATA row; one still waiting gets a new
    PENDING row, which is harmless.
    """
    pending = await get_pending_claims_for_ticker(ticker)
    for row in pending:
        await verify_claim(
            claim_id=str(row["id"]),
            claim_quarter=row["quarter"],
            claim_metric=row["metric"],
            target_value=row["target_value"],
            target_unit=row["target_unit"],
            ticker=ticker,
            job_id=job_id,
            raw_quote=row["raw_quote"],
        )
    if pending:
        logger.info(
            "Re-verified pending claims",
            extra={"ticker": ticker, "jobId": job_id, "count": len(pending)},
        )


async def _do_extraction(ticker: str, job_id: str) -> None:
    company_id = await get_company_id_by_ticker(ticker)
    if company_id is None:
        logger.warning("Company not found in DB", extra={"ticker": ticker, "jobId": job_id})
        await emit_progress(
            ProgressEvent(
                event="analysis-failed",
                jobId=job_id,
                stepIndex=0,
                totalSteps=1,
                message=f"Company '{ticker}' not found in database",
                timestamp=datetime.now(timezone.utc).isoformat(),
            )
        )
        return

    company_name = await resolve_company_name(ticker)
    if company_name:
        await set_company_name_if_placeholder(ticker, company_name.title() if company_name.isupper() else company_name)

    # Ingest transcripts from EDGAR before extraction so a fresh DB is populated.
    # ingest_8k_transcripts is idempotent — cached (ticker, quarter) rows are skipped.
    end_date = datetime.now(timezone.utc).date()
    start_date = end_date - timedelta(days=_INGEST_LOOKBACK_DAYS)
    await emit_progress(
        ProgressEvent(
            event="transcript-fetched",
            jobId=job_id,
            stepIndex=0,
            totalSteps=1,
            message=f"Fetching EDGAR transcripts for {ticker}…",
            timestamp=datetime.now(timezone.utc).isoformat(),
        )
    )
    summary = await ingest_8k_transcripts(
        ticker, start_date.isoformat(), end_date.isoformat()
    )
    logger.info(
        "Ingestion complete before extraction",
        extra={
            "ticker": ticker,
            "jobId": job_id,
            "transcripts": summary.transcripts_extracted,
            "press_releases": summary.press_releases_extracted,
        },
    )

    await _reverify_pending_claims(ticker, job_id)

    transcripts = await get_all_transcripts_for_ticker(ticker)
    if not transcripts:
        logger.info("No valid transcripts found", extra={"ticker": ticker, "jobId": job_id})
        await emit_progress(
            ProgressEvent(
                event="analysis-failed",
                jobId=job_id,
                stepIndex=0,
                totalSteps=1,
                message=f"No transcripts with status SUCCESS or PRESS_RELEASE found for {ticker}",
                timestamp=datetime.now(timezone.utc).isoformat(),
            )
        )
        return

    # totalSteps = one step per transcript + final complete step
    total_steps = len(transcripts) + 1
    await emit_progress(
        ProgressEvent(
            event="analysis-started",
            jobId=job_id,
            stepIndex=0,
            totalSteps=total_steps,
            message=f"Reading {len(transcripts)} quarterly filings for {ticker}",
            timestamp=datetime.now(timezone.utc).isoformat(),
        )
    )

    existing_claims = await get_existing_claim_keys(company_id)

    claims_found = 0
    step = 1
    for transcript in transcripts:
        quarter = transcript["quarter"]
        raw_text = transcript["raw_text"]

        if not raw_text:
            logger.warning(
                "Skipping transcript with empty raw_text",
                extra={"ticker": ticker, "quarter": quarter, "jobId": job_id},
            )
            step += 1
            continue

        result = await extract_claims(
            transcript_text=raw_text,
            ticker=ticker,
            quarter=quarter,
            job_id=job_id,
        )

        if result.errors:
            for err in result.errors:
                logger.warning(
                    "Claim extraction error",
                    extra={
                        "ticker": ticker,
                        "quarter": quarter,
                        "jobId": job_id,
                        "error_reason": err.error_reason,
                        "raw_segment": err.raw_segment[:200],
                    },
                )

        # Re-runs re-extract the same transcripts — skip claims already stored so
        # they are not duplicated (verdicts for them are refreshed separately).
        new_claims = [
            c for c in result.claims
            if (c.quarter, c.raw_quote, c.metric) not in existing_claims
        ]
        result.claims = new_claims
        claims_found += len(new_claims)

        if result.claims:
            claim_dicts = [
                {
                    "company_id": company_id,
                    "quarter": claim.quarter,
                    "raw_quote": claim.raw_quote,
                    "metric": claim.metric,
                    "target_value": claim.target_value,
                    "target_unit": claim.target_unit,
                    "extraction_confidence": Decimal(str(claim.extraction_confidence)),
                    "speaker": claim.speaker,
                }
                for claim in result.claims
            ]
            claim_ids = await insert_claim_batch(claim_dicts)
            await emit_progress(
                ProgressEvent(
                    event="claims-extracted",
                    jobId=job_id,
                    stepIndex=step,
                    totalSteps=total_steps,
                    message=f"Extracted {len(result.claims)} claims for {ticker} {quarter}",
                    timestamp=datetime.now(timezone.utc).isoformat(),
                )
            )

            for claim_id, claim in zip(claim_ids, result.claims):
                verification_result = await verify_claim(
                    claim_id=claim_id,
                    claim_quarter=claim.quarter,
                    claim_metric=claim.metric,
                    target_value=claim.target_value,
                    target_unit=claim.target_unit,
                    ticker=ticker,
                    job_id=job_id,
                    raw_quote=claim.raw_quote,
                    timeframe=claim.timeframe,
                )
                step += 1
                await emit_progress(
                    ProgressEvent(
                        event="claim-verified",
                        jobId=job_id,
                        stepIndex=step,
                        totalSteps=total_steps,
                        message=(
                            f"Verified {claim.metric} for {ticker} {claim.quarter}: "
                            f"{verification_result.verdict_type}"
                        ),
                        timestamp=datetime.now(timezone.utc).isoformat(),
                    )
                )

        step += 1

    await emit_progress(
        ProgressEvent(
            event="analysis-complete",
            jobId=job_id,
            stepIndex=total_steps,
            totalSteps=total_steps,
            message=(
                f"Claim extraction complete for {ticker}"
                if claims_found or existing_claims
                else f"No forward-looking numerical guidance found in {ticker}'s filings"
            ),
            timestamp=datetime.now(timezone.utc).isoformat(),
        )
    )


@router.post("/analyze/{ticker}", status_code=202)
async def analyze_ticker(
    ticker: str, body: AnalyzeRequest, background_tasks: BackgroundTasks
) -> JSONResponse:
    upper = ticker.upper()

    # Pre-flight: verify company exists before dispatching to background.
    # Transcript ingestion is handled inside _do_extraction (chained automatically).
    company_id = await get_company_id_by_ticker(upper)
    if company_id is None:
        raise HTTPException(
            status_code=404,
            detail=f"Company '{upper}' not found. Ensure it was created via the NestJS analyze endpoint first.",
        )

    background_tasks.add_task(_run_extraction, upper, body.jobId)
    return JSONResponse(
        status_code=202,
        content={"jobId": body.jobId, "status": "QUEUED"},
    )
