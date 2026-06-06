"""Pydantic models for numerical claim extraction (story 4.1 + 4.2)."""

import re
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, field_validator
from pydantic.alias_generators import to_camel

ClaimType = Literal["revenue", "earnings", "margin", "guidance", "growth", "other"]

_QUARTER_RE = re.compile(r"^Q[1-4]-\d{4}$")


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
    extraction_confidence: Decimal

    @field_validator("quarter")
    @classmethod
    def quarter_format(cls, v: str) -> str:
        if not _QUARTER_RE.match(v):
            raise ValueError(f"quarter must match Q[1-4]-YYYY, got: {v!r}")
        return v

    @field_validator("extraction_confidence")
    @classmethod
    def confidence_range(cls, v: Decimal) -> Decimal:
        if not (Decimal("0") <= v <= Decimal("1")):
            raise ValueError(f"extraction_confidence must be 0–1, got: {v}")
        return v


class ExtractionError(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    raw_segment: str
    error_reason: str


class BoilerplateSegment(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    raw_segment: str
    reason: Literal["safe_harbour_boilerplate"]


class ExtractionResult(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    claims: list[ExtractedClaim]
    errors: list[ExtractionError]
    boilerplate_segments: list[BoilerplateSegment] = []
    ticker: str
    quarter: str
