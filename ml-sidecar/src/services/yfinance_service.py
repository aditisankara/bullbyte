import asyncio
import datetime

from src.core.logging import get_logger
from src.models.financials_models import FinancialMetric

logger = get_logger("ml-sidecar.yfinance_service")

_METRIC_TO_ROW_LABEL: dict[str, str] = {
    "revenue": "Total Revenue",
    "eps_basic": "Basic EPS",
    "eps_diluted": "Diluted EPS",
    "operating_income": "Operating Income",
    "gross_profit": "Gross Profit",
    "net_income": "Net Income",
}


def _quarter_to_period_end_date(quarter: str) -> datetime.date:
    """Map 'Q3-2024' to the calendar period end date as a datetime.date."""
    parts = quarter.split("-")
    if len(parts) != 2 or len(parts[0]) < 2:
        raise ValueError(f"Invalid quarter format {quarter!r}; expected 'Q{{n}}-{{YYYY}}'")
    try:
        q_num = int(parts[0][1:])
        year = int(parts[1])
    except ValueError:
        raise ValueError(f"Invalid quarter format {quarter!r}; expected 'Q{{n}}-{{YYYY}}'")
    ends = {
        1: datetime.date(year, 3, 31),
        2: datetime.date(year, 6, 30),
        3: datetime.date(year, 9, 30),
        4: datetime.date(year, 12, 31),
    }
    if q_num not in ends:
        raise ValueError(f"Invalid quarter number {q_num!r} in {quarter!r}; expected Q1–Q4")
    return ends[q_num]


def _extract_yfinance_metrics(
    ticker: str,
    quarter: str,
    df: "pd.DataFrame",
    metrics_needed: list[str],
) -> list[FinancialMetric]:
    """Extract FinancialMetric objects from a yfinance quarterly_income_stmt DataFrame."""
    import math

    target = _quarter_to_period_end_date(quarter)
    tolerance = datetime.timedelta(days=45)

    # Find the best matching column
    best_col = None
    best_delta = datetime.timedelta(days=46)
    for col in df.columns:
        try:
            delta = abs(col.date() - target)
        except AttributeError:
            continue
        if delta < best_delta:
            best_delta = delta
            best_col = col
    if best_col is None or best_delta > tolerance:
        return []

    results: list[FinancialMetric] = []
    for metric_name in metrics_needed:
        row_label = _METRIC_TO_ROW_LABEL.get(metric_name)
        if row_label is None:
            continue
        try:
            raw_value = df.loc[row_label, best_col]
        except KeyError:
            continue
        try:
            float_value = float(raw_value)
        except (TypeError, ValueError):
            continue
        if math.isnan(float_value) or math.isinf(float_value):
            continue
        results.append(FinancialMetric(
            ticker=ticker,
            quarter=quarter,
            metric_name=metric_name,
            value=str(float_value),
            unit="USD",
            section_reference=f"yfinance/{row_label}",
            filing_url="",
            filing_type="yfinance",
            parse_status="SUCCESS",
            source="yfinance",
        ))
    return results


async def supplement_with_yfinance(
    ticker: str,
    quarter: str,
    metrics_needed: list[str],
) -> list[FinancialMetric]:
    """Fetch yfinance quarterly data and return FinancialMetric list for requested metrics.

    Never raises — returns [] on any failure.
    """
    logger.info(
        "yfinance supplement start",
        extra={
            "ticker": ticker,
            "quarter": quarter,
            "metrics_requested": metrics_needed,
            "source": "yfinance",
        },
    )
    loop = asyncio.get_running_loop()
    try:
        def _sync_fetch() -> list[FinancialMetric]:
            import yfinance as yf
            ticker_obj = yf.Ticker(ticker)
            df = ticker_obj.quarterly_income_stmt
            return _extract_yfinance_metrics(ticker, quarter, df, metrics_needed)

        results: list[FinancialMetric] = await loop.run_in_executor(None, _sync_fetch)
        logger.info(
            "yfinance supplement complete",
            extra={
                "ticker": ticker,
                "quarter": quarter,
                "metrics_requested": metrics_needed,
                "metrics_returned": [m.metric_name for m in results],
                "source": "yfinance",
            },
        )
        return results
    except Exception as exc:
        logger.error(
            "yfinance supplement failed",
            extra={
                "ticker": ticker,
                "quarter": quarter,
                "metrics_requested": metrics_needed,
                "metrics_returned": [],
                "source": "yfinance",
                "error": str(exc),
            },
        )
        return []
