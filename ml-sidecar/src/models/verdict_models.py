"""Pydantic models for claim verification verdicts (story 4.3)."""

from typing import Literal

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

VerdictType = Literal["DELIVERED", "MISSED", "INSUFFICIENT_DATA"]


class VerificationResult(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    claim_id: str
    verdict_id: str
    verdict_type: VerdictType
    actual_value: str | None
    actuals_quarter: str
    mapping_rationale: str
