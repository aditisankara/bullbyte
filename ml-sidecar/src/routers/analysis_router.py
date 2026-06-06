"""Analysis router — LLM-based claim extraction pipeline (story 4.1)."""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from src.core.logging import get_logger
from src.core.progress_webhook import emit_progress
from src.db.queries import (
    get_all_transcripts_for_ticker,
    get_company_id_by_ticker,
    insert_claim_batch,
)
from src.models.progress_models import ProgressEvent
from src.services.extraction_service import extract_claims

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
            message=f"Starting claim extraction for {ticker} ({len(transcripts)} transcripts)",
            timestamp=datetime.now(timezone.utc).isoformat(),
        )
    )

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

        if result.claims:
            claim_dicts = [
                {
                    "company_id": company_id,
                    "quarter": claim.quarter,
                    "raw_quote": claim.raw_quote,
                    "metric": claim.metric,
                    "target_value": claim.target_value,
                    "extraction_confidence": Decimal(str(claim.extraction_confidence)),
                    "speaker": claim.speaker,
                }
                for claim in result.claims
            ]
            await insert_claim_batch(claim_dicts)
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

        step += 1

    await emit_progress(
        ProgressEvent(
            event="analysis-complete",
            jobId=job_id,
            stepIndex=total_steps,
            totalSteps=total_steps,
            message=f"Claim extraction complete for {ticker}",
            timestamp=datetime.now(timezone.utc).isoformat(),
        )
    )


@router.post("/analyze/{ticker}", status_code=202)
async def analyze_ticker(
    ticker: str, body: AnalyzeRequest, background_tasks: BackgroundTasks
) -> JSONResponse:
    upper = ticker.upper()

    # Pre-flight: verify company exists before dispatching to background
    company_id = await get_company_id_by_ticker(upper)
    if company_id is None:
        raise HTTPException(
            status_code=404,
            detail=f"Company '{upper}' not found. Add it to the companies table and run ingestion first.",
        )

    # Pre-flight: verify at least one usable transcript exists
    transcripts = await get_all_transcripts_for_ticker(upper)
    if not transcripts:
        raise HTTPException(
            status_code=422,
            detail=f"No ingested transcripts found for '{upper}' (status SUCCESS or PRESS_RELEASE). Run ingestion first.",
        )

    background_tasks.add_task(_run_extraction, upper, body.jobId)
    return JSONResponse(
        status_code=202,
        content={"jobId": body.jobId, "status": "QUEUED", "transcriptCount": len(transcripts)},
    )
