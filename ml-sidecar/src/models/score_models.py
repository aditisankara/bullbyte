"""Pydantic model for CEO Delivery Score (story 4.6)."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class CeoDeliveryScore(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    ticker: str
    score: float | None          # delivered / total_resolved; None when no resolved claims
    delivered_count: int
    missed_count: int
    insufficient_data_count: int
    pending_count: int
    total_resolved: int          # delivered_count + missed_count only
    context_message: str         # human-readable summary always present
