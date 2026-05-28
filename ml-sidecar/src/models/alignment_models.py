from typing import Literal

from pydantic import BaseModel

AlignmentConfidence = Literal["HIGH", "MEDIUM", "LOW"]
AlignmentStatus = Literal["ALIGNED", "PENDING", "AMBIGUOUS", "FETCH_ERROR"]


class AlignmentDecision(BaseModel):
    ticker: str
    call_quarter: str
    actuals_quarter: str
    filing_type: str
    filing_url: str
    alignment_confidence: AlignmentConfidence
    mapping_rationale: str
    status: AlignmentStatus
