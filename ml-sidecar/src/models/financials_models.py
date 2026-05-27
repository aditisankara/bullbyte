
from typing import Literal

from pydantic import BaseModel

FinancialMetricStatus = Literal["SUCCESS", "AMBIGUOUS", "PARSE_FAILURE", "FETCH_ERROR"]

FinancialsResultStatus = Literal["SUCCESS", "PARTIAL", "FILING_NOT_YET_AVAILABLE", "FETCH_ERROR"]


class FinancialMetric(BaseModel):
    ticker: str
    quarter: str
    metric_name: str
    value: str
    unit: str
    section_reference: str
    filing_url: str
    filing_type: str
    parse_status: FinancialMetricStatus


class FinancialsResult(BaseModel):
    ticker: str
    quarter: str
    filing_type: str
    status: FinancialsResultStatus
    metrics: list[FinancialMetric]
    filing_url: str
