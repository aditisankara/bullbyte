"""FastAPI -> NestJS progress webhook client (story 5.3).

After each agent step, the analysis pipeline calls `emit_progress(event)`, which
POSTs the event to the NestJS internal webhook. NestJS relays it to the active SSE
stream for that job so the frontend feed updates within 5s (NFR5).

Transport failures are swallowed and logged: a missing or unhealthy NestJS must
never interrupt the analysis run (story 5.3 AC3). Config is read from the
environment — no hardcoded URLs or secrets (NFR12).
"""

import asyncio
import os

import httpx

from src.core.logging import get_logger
from src.models.progress_models import ProgressEvent

logger = get_logger("ml-sidecar.webhook")

# Matches the NestJS InternalWebhookGuard header.
_TOKEN_HEADER = "X-Internal-Token"
_TIMEOUT_SECONDS = 5.0
_TERMINAL_EVENTS = {"analysis-complete", "analysis-failed"}
_TERMINAL_ATTEMPTS = 4
_RETRY_DELAY_SECONDS = 2.0


async def emit_progress(event: ProgressEvent) -> None:
    """Relay one progress event to NestJS. Best-effort: never raises."""
    base_url = os.environ.get("NESTJS_WEBHOOK_URL")
    if not base_url:
        logger.warning(
            "NESTJS_WEBHOOK_URL not set — skipping progress webhook",
            extra={"jobId": event.job_id, "event": event.event},
        )
        return

    url = f"{base_url.rstrip('/')}/jobs/{event.job_id}/progress"
    headers = {_TOKEN_HEADER: os.environ.get("INTERNAL_WEBHOOK_SECRET", "")}

    # Terminal events flip the job's DB status; retry them so one dropped POST
    # cannot leave the job RUNNING forever. Intermediate events stay best-effort.
    attempts = _TERMINAL_ATTEMPTS if event.event in _TERMINAL_EVENTS else 1
    error = ""
    for attempt in range(attempts):
        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS) as client:
                response = await client.post(
                    url, json=event.model_dump(by_alias=True), headers=headers
                )
            # httpx does not raise on 4xx/5xx — a 429 used to be silently dropped.
            if response.status_code < 400:
                return
            error = f"HTTP {response.status_code}"
        except httpx.HTTPError as exc:
            error = str(exc)
        if attempt + 1 < attempts:
            await asyncio.sleep(_RETRY_DELAY_SECONDS * (attempt + 1))

    # Best-effort: the analysis run continues regardless of the webhook (AC3).
    logger.warning(
        "Progress webhook delivery failed",
        extra={"jobId": event.job_id, "event": event.event, "error": error},
    )
