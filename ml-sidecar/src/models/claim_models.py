"""Pydantic models for numerical claim extraction (story 4.1)."""

from typing import Literal

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

ClaimType = Literal["revenue", "earnings", "margin", "guidance", "growth", "other"]


class ExtractedClaim(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    raw_quote: str
    claim_type: ClaimType
    metric: str
    target_value: str
    target_unit: str | None = None
    timeframe: str
    speaker: str | None = None
    quarter: str


class ExtractionError(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    raw_segment: str
    error_reason: str


class ExtractionResult(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    claims: list[ExtractedClaim]
    errors: list[ExtractionError]
    ticker: str
    quarter: str
