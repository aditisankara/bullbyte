"""Pick the 10-Q / 10-K that reports a given calendar quarter.

Claim quarters are calendar-based ("Q2-2025" = Apr–Jun 2025), but companies close
their books on their own fiscal calendars (NVIDIA: late Jan/Apr/Jul/Oct, Microsoft:
Jun 30 year-end, Apple: late Sep). Matching filings by *filing date* and assuming Q4
means "10-K" therefore finds the wrong filing — or none — for most off-calendar filers.

EDGAR's submissions index carries each filing's `reportDate` (the period it covers),
so we match on that instead: the filing whose period ends within ~45 days of the
calendar quarter end, whatever form it was filed on.
"""

from __future__ import annotations

from datetime import datetime, timedelta

_PERIODIC_FORMS = {"10-Q", "10-K"}
_REPORT_DATE_TOLERANCE_DAYS = 45


def calendar_quarter_end(quarter: str) -> datetime:
    """'Q3-2024' -> 2024-09-30. Raises ValueError on a malformed quarter."""
    try:
        q_part, year_part = quarter.split("-")
        q_num = int(q_part[1:])
        year = int(year_part)
    except (ValueError, IndexError):
        raise ValueError(f"Invalid quarter format: {quarter!r}")
    ends = {1: (3, 31), 2: (6, 30), 3: (9, 30), 4: (12, 31)}
    if q_num not in ends or not q_part.upper().startswith("Q"):
        raise ValueError(f"Invalid quarter format: {quarter!r}")
    month, day = ends[q_num]
    return datetime(year, month, day)


def _parse(date_str: str | None) -> datetime | None:
    try:
        return datetime.strptime(date_str, "%Y-%m-%d") if date_str else None
    except ValueError:
        return None


def select_filing_entry(
    entries: list[dict], quarter: str, filing_type: str | None = None
) -> dict | None:
    """Return the submissions entry (accessionNumber/filingDate/form/reportDate) that
    reports `quarter`, or None when it has not been filed.

    When the index carries report dates, they decide the match and `filing_type` is
    ignored. Without them (older/mocked payloads) fall back to "earliest `filing_type`
    filing within 180 days after the calendar quarter end".
    """
    target = calendar_quarter_end(quarter)

    dated = [
        e for e in entries
        if e.get("form") in _PERIODIC_FORMS and _parse(e.get("reportDate")) is not None
    ]
    if dated:
        tolerance = timedelta(days=_REPORT_DATE_TOLERANCE_DAYS)
        near = [e for e in dated if abs(_parse(e["reportDate"]) - target) <= tolerance]
        if not near:
            return None
        return min(near, key=lambda e: e["filingDate"])

    cutoff = target + timedelta(days=180)
    matches = []
    for entry in entries:
        if filing_type is not None and entry.get("form") != filing_type:
            continue
        filing_dt = _parse(entry.get("filingDate"))
        if filing_dt is not None and target <= filing_dt <= cutoff:
            matches.append(entry)
    if not matches:
        return None
    return min(matches, key=lambda e: e["filingDate"])
