"""CEO Delivery Score computation service (story 4.6)."""

from __future__ import annotations

from src.core.logging import get_logger
from src.db.queries import get_verdicts_for_ticker
from src.models.score_models import CeoDeliveryScore

logger = get_logger("ml-sidecar.scoring_service")


async def compute_ceo_delivery_score(ticker: str) -> CeoDeliveryScore:
    """Aggregate all resolved verdicts for a company into a CEO Delivery Score.

    Reads directly from the append-only verdicts table — no separate score cache.
    Returns score=None when no resolved (DELIVERED or MISSED) verdicts exist.
    """
    ticker = ticker.upper()
    rows = await get_verdicts_for_ticker(ticker)

    counts: dict[str, int] = {}
    for row in rows:
        counts[row["verdict_type"]] = row["count"]

    delivered = counts.get("DELIVERED", 0)
    missed = counts.get("MISSED", 0)
    insufficient = counts.get("INSUFFICIENT_DATA", 0)
    pending = counts.get("PENDING", 0)
    total_resolved = delivered + missed

    if total_resolved == 0:
        score = None
        context_message = "No resolved claims yet"
    else:
        score = delivered / total_resolved
        context_message = (
            f"{delivered} of {total_resolved} resolved promises delivered"
            + (f" — {pending} pending" if pending else "")
            + (f" — {insufficient} insufficient data" if insufficient else "")
        )

    logger.info(
        "CEO Delivery Score computed",
        extra={
            "ticker": ticker,
            "score": score,
            "delivered": delivered,
            "missed": missed,
            "total_resolved": total_resolved,
        },
    )

    return CeoDeliveryScore(
        ticker=ticker,
        score=score,
        delivered_count=delivered,
        missed_count=missed,
        insufficient_data_count=insufficient,
        pending_count=pending,
        total_resolved=total_resolved,
        context_message=context_message,
    )
