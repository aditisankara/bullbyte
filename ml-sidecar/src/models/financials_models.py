
from typing import Literal

from pydantic import BaseModel

FinancialMetricStatus = Literal["SUCCESS", "AMBIGUOUS", "PARSE_FAILURE", "FETCH_ERROR"]

FinancialMetricSource = Literal["edgar", "yfinance"]

FinancialsResultStatus = Literal["SUCCESS", "PARTIAL", "FILING_NOT_YET_AVAILABLE", "FETCH_ERROR"]


FinancialMetricPeriod = Literal["quarterly", "annual"]


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
    source: FinancialMetricSource = "edgar"
    # A 10-K's XBRL facts carry both the standalone Q4 figure and the full-year
    # total for the same concept (e.g. Revenues) — this disambiguates which one
    # a metric is, so a single-quarter claim is never matched against an FY sum.
    period: FinancialMetricPeriod = "quarterly"
    # ISO date the figure's reporting period ends. Rows cached before this field
    # existed were extracted with year-to-date / wrong-year logic and are re-fetched.
    period_end: str | None = None


class FinancialsResult(BaseModel):
    ticker: str
    quarter: str
    filing_type: str
    status: FinancialsResultStatus
    metrics: list[FinancialMetric]
    filing_url: str
