"""FastAPI -> NestJS progress webhook client (story 5.3).

After each agent step, the analysis pipeline calls `emit_progress(event)`, which
POSTs the event to the NestJS internal webhook. NestJS relays it to the active SSE
stream for that job so the frontend feed updates within 5s (NFR5).

Transport failures are swallowed and logged: a missing or unhealthy NestJS must
never interrupt the analysis run (story 5.3 AC3). Config is read from the
environment — no hardcoded URLs or secrets (NFR12).
"""

import os

import httpx

from src.core.logging import get_logger
from src.models.progress_models import ProgressEvent

logger = get_logger("ml-sidecar.webhook")

# Matches the NestJS InternalWebhookGuard header.
_TOKEN_HEADER = "X-Internal-Token"
_TIMEOUT_SECONDS = 5.0


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

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS) as client:
            await client.post(
                url, json=event.model_dump(by_alias=True), headers=headers
            )
    except httpx.HTTPError as exc:
        # Best-effort: the analysis run continues regardless of the webhook (AC3).
        logger.warning(
            "Progress webhook delivery failed",
            extra={
                "jobId": event.job_id,
                "event": event.event,
                "error": str(exc),
            },
        )
