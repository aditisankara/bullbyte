"""
10-Q/10-K financial actuals ingestion service.

Entry point: ``ingest_financial_actuals(ticker, quarter)``
Returns an in-memory ``FinancialsResult`` — no DB writes (persistence is story 3.6).
All HTTP calls go through ``get_client()`` from ``src.core.edgar_client``.
"""
import json
import re
from datetime import datetime, timedelta

from bs4 import BeautifulSoup

from src.core.edgar_client import EdgarFetchError, get_client
from src.core.logging import get_logger
from src.models.financials_models import FinancialMetric, FinancialMetricStatus, FinancialsResult
from src.services.ingestion_service import resolve_cik
from src.services.yfinance_service import supplement_with_yfinance

logger = get_logger("ml-sidecar.financials_service")

# Priority-ordered fallback lists. First match in the XBRL facts wins.
XBRL_METRIC_CONCEPTS: dict[str, list[tuple[str, str]]] = {
    "revenue": [
        ("us-gaap", "RevenueFromContractWithCustomerExcludingAssessedTax"),
        ("us-gaap", "Revenues"),
        ("us-gaap", "SalesRevenueNet"),
        ("us-gaap", "SalesRevenueGoodsNet"),
    ],
    "eps_basic": [
        ("us-gaap", "EarningsPerShareBasic"),
    ],
    "eps_diluted": [
        ("us-gaap", "EarningsPerShareDiluted"),
    ],
    "operating_income": [
        ("us-gaap", "OperatingIncomeLoss"),
    ],
    "gross_profit": [
        ("us-gaap", "GrossProfit"),
    ],
    "net_income": [
        ("us-gaap", "NetIncomeLoss"),
        ("us-gaap", "NetIncomeLossAvailableToCommonStockholdersBasic"),
    ],
}
# gross_margin is derived from gross_profit / revenue — not in this map


# ── Task 3: Filing type helper ────────────────────────────────────────────────

def _quarter_to_filing_type(quarter: str) -> str:
    """Return '10-K' for Q4, '10-Q' for Q1/Q2/Q3."""
    return "10-K" if quarter.upper().startswith("Q4") else "10-Q"


# ── Task 4: XBRL facts fetcher ────────────────────────────────────────────────

async def _fetch_xbrl_facts(cik: str, ticker: str) -> dict:
    """Fetch XBRL company facts JSON for ``cik``. Raises ``EdgarFetchError`` on failure."""
    url = f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json"
    response = await get_client().fetch(url, ticker=ticker, filing_type="xbrl-facts")
    try:
        return response.json()
    except (json.JSONDecodeError, ValueError) as exc:
        raise EdgarFetchError(
            ticker=ticker, filing_type="xbrl-facts", url=url, final_status=response.status_code
        ) from exc


# ── Task 5: Period-end calculator ─────────────────────────────────────────────

def _quarter_to_period_end(quarter: str) -> str:
    """Map 'Q3-2024' to approximate calendar period end date for XBRL matching."""
    parts = quarter.split("-")
    if len(parts) != 2 or len(parts[0]) < 2:
        raise ValueError(f"Invalid quarter format {quarter!r}; expected 'Q{{n}}-{{YYYY}}'")
    try:
        q_num = int(parts[0][1])
        year = int(parts[1])
    except ValueError:
        raise ValueError(f"Invalid quarter format {quarter!r}; expected 'Q{{n}}-{{YYYY}}'")
    ends = {1: f"{year}-03-31", 2: f"{year}-06-30", 3: f"{year}-09-30", 4: f"{year}-12-31"}
    if q_num not in ends:
        raise ValueError(f"Invalid quarter number {q_num!r} in {quarter!r}; expected Q1–Q4")
    return ends[q_num]


# ── Task 6: XBRL metric extractor ─────────────────────────────────────────────

def _extract_xbrl_metrics(
    xbrl_data: dict,
    ticker: str,
    quarter: str,
    filing_type: str,
    filing_url: str,
) -> list[FinancialMetric]:
    """Extract structured financial metrics from XBRL company facts data."""
    period_end = _quarter_to_period_end(quarter)
    period_end_dt = datetime.strptime(period_end, "%Y-%m-%d")
    year = int(quarter.split("-")[1])
    is_annual = filing_type == "10-K"

    metrics: list[FinancialMetric] = []
    us_gaap = xbrl_data.get("facts", {}).get("us-gaap", {})

    extracted: dict[str, FinancialMetric] = {}

    for metric_name, concepts in XBRL_METRIC_CONCEPTS.items():
        matched_metric: FinancialMetric | None = None
        ambiguous = False

        for namespace, concept_name in concepts:
            concept_data = us_gaap.get(concept_name, {})
            units_map = concept_data.get("units", {})
            if not units_map:
                continue

            if len(units_map) > 1:
                logger.warning(
                    "Multiple unit keys for concept — using first",
                    extra={"ticker": ticker, "concept": concept_name, "unit_keys": list(units_map)},
                )
            unit_key = next(iter(units_map))
            entries = units_map[unit_key]

            # Find entries matching this period
            candidates = []
            for entry in entries:
                if entry.get("form") != filing_type:
                    continue
                if "val" not in entry:
                    continue
                entry_end = entry.get("end", "")
                if not entry_end:
                    continue
                try:
                    entry_end_dt = datetime.strptime(entry_end, "%Y-%m-%d")
                except ValueError:
                    continue

                if is_annual:
                    # 10-K: fp=="FY" + fy==year is the period specifier; no date constraint
                    # so off-calendar fiscal years (e.g. Apple FY ends September) are captured.
                    if entry.get("fp") != "FY" or int(entry.get("fy", 0)) != year:
                        continue
                    delta = abs((entry_end_dt - period_end_dt).days)
                else:
                    # 10-Q: exclude annual summary entries that fall within the date window
                    if entry.get("fp") == "FY":
                        continue
                    delta = abs((entry_end_dt - period_end_dt).days)
                    if delta > 45:
                        continue

                candidates.append((delta, entry, unit_key, concept_name))

            if not candidates:
                continue

            # Best candidate: closest end date to expected period end
            candidates.sort(key=lambda x: x[0])
            best = candidates[0]
            best_delta, best_entry, best_unit, best_concept = best

            candidate_metric = FinancialMetric(
                ticker=ticker,
                quarter=quarter,
                metric_name=metric_name,
                value=str(best_entry["val"]),
                unit=best_unit,
                section_reference=f"us-gaap/{best_concept}",
                filing_url=filing_url,
                filing_type=filing_type,
                parse_status="SUCCESS",
            )

            if matched_metric is None:
                matched_metric = candidate_metric
            else:
                # A later concept also matched — check for conflict against the first match
                if matched_metric.value != candidate_metric.value:
                    ambiguous = True
                    logger.warning(
                        "AMBIGUOUS metric — conflicting concept values",
                        extra={
                            "ticker": ticker,
                            "quarter": quarter,
                            "metric_name": metric_name,
                            "concept_1": matched_metric.section_reference,
                            "value_1": matched_metric.value,
                            "concept_2": f"us-gaap/{best_concept}",
                            "value_2": candidate_metric.value,
                        },
                    )
                    break  # conflict confirmed — no need to check further concepts
                # Values agree: keep first (most canonical) match and continue scanning

        if matched_metric is not None:
            if ambiguous:
                matched_metric = matched_metric.model_copy(update={"parse_status": "AMBIGUOUS"})
                logger.warning(
                    "AMBIGUOUS metric — skipping",
                    extra={
                        "ticker": ticker,
                        "quarter": quarter,
                        "metric_name": metric_name,
                        "filing_url": filing_url,
                        "section_reference": matched_metric.section_reference,
                    },
                )
            metrics.append(matched_metric)
            extracted[metric_name] = matched_metric

    # Derive gross_margin from gross_profit / revenue
    revenue_metric = extracted.get("revenue")
    gross_profit_metric = extracted.get("gross_profit")
    if revenue_metric and gross_profit_metric:
        try:
            margin = float(gross_profit_metric.value) / float(revenue_metric.value)
            metrics.append(FinancialMetric(
                ticker=ticker,
                quarter=quarter,
                metric_name="gross_margin",
                value=f"{margin:.4f}",
                unit="ratio",
                section_reference="derived:gross_profit/revenue",
                filing_url=filing_url,
                filing_type=filing_type,
                parse_status="SUCCESS",
            ))
        except (ValueError, ZeroDivisionError) as exc:
            logger.warning(
                "gross_margin derivation skipped",
                extra={"ticker": ticker, "quarter": quarter, "reason": str(exc)},
            )

    return metrics


# ── Task 7: Guidance extractor ────────────────────────────────────────────────

_GUIDANCE_KEYWORDS = ["guidance", "outlook", "expects", "anticipates", "full year", "next quarter", "fiscal year"]
_VALUE_PATTERN = re.compile(r"\$[\d.,]+[BMK]?|\d+\.?\d*%")


async def _extract_guidance_from_html(
    cik: str,
    accession_no: str,
    ticker: str,
    quarter: str,
    filing_type: str,
    filing_url: str,
) -> list[FinancialMetric]:
    """Best-effort: extract forward guidance passages from the primary 10-Q/10-K HTML document."""
    accession_path = accession_no.replace("-", "")
    cik_int = str(int(cik))

    try:
        index_url = (
            f"https://www.sec.gov/Archives/edgar/data/{cik_int}"
            f"/{accession_path}/{accession_no}-index.htm"
        )
        index_resp = await get_client().fetch(index_url, ticker=ticker, filing_type="filing-index")
        soup = BeautifulSoup(index_resp.text, "lxml")

        # Find primary 10-Q/10-K document (not exhibits)
        primary_doc_url: str | None = None
        for row in soup.select("table tr"):
            cells = row.find_all("td")
            if len(cells) < 3:
                continue
            doc_type = cells[1].get_text(strip=True)
            link = cells[2].find("a")
            if link is None:
                continue
            filename = link.get("href", "").split("/")[-1].split("?")[0]
            if not filename:
                continue
            if doc_type in (filing_type, filing_type.replace("-", "")):
                primary_doc_url = (
                    f"https://www.sec.gov/Archives/edgar/data/{cik_int}"
                    f"/{accession_path}/{filename}"
                )
                break

        if primary_doc_url is None:
            logger.warning(
                "Could not find primary filing document in index",
                extra={"ticker": ticker, "quarter": quarter, "index_url": index_url},
            )
            return []

        doc_resp = await get_client().fetch(primary_doc_url, ticker=ticker, filing_type=f"{filing_type}-document")
        doc_soup = BeautifulSoup(doc_resp.text, "lxml")

        guidance_metrics: list[FinancialMetric] = []
        passages_found = 0
        seen_guidance_texts: set[str] = set()

        for tag in doc_soup.find_all(["p", "div", "span"]):
            if passages_found >= 3:
                break
            text = tag.get_text(separator=" ", strip=True).lower()
            keyword_hits = sum(1 for kw in _GUIDANCE_KEYWORDS if kw in text)
            if keyword_hits < 2:
                continue

            full_text = tag.get_text(separator=" ", strip=True)
            # Deduplicate: skip nested tags whose text is a prefix of an already-seen passage
            text_key = full_text[:100]
            if text_key in seen_guidance_texts:
                continue
            seen_guidance_texts.add(text_key)

            value_match = _VALUE_PATTERN.search(full_text)

            # Find nearest heading for section reference
            heading = tag.find_previous(["h1", "h2", "h3", "h4"])
            section_ref = heading.get_text(strip=True) if heading else "guidance-section"

            if value_match:
                extracted_value = value_match.group(0)
                unit = "percent" if "%" in extracted_value else "USD"
                parse_status: FinancialMetricStatus = "SUCCESS"
            else:
                extracted_value = full_text[:200]
                unit = "text"
                parse_status = "AMBIGUOUS"

            passages_found += 1
            guidance_metrics.append(FinancialMetric(
                ticker=ticker,
                quarter=quarter,
                metric_name=f"guidance_{passages_found}",
                value=extracted_value,
                unit=unit,
                section_reference=section_ref,
                filing_url=filing_url,
                filing_type=filing_type,
                parse_status=parse_status,
            ))

        return guidance_metrics

    except EdgarFetchError as exc:
        logger.error(
            "Guidance extraction failed — EDGAR fetch error",
            extra={"ticker": ticker, "quarter": quarter, "error": str(exc)},
        )
        return []
    except Exception as exc:
        logger.warning(
            "Guidance extraction failed — parse error",
            extra={"ticker": ticker, "quarter": quarter, "error": str(exc)},
        )
        return []


# ── Task 8: Filing lookup ─────────────────────────────────────────────────────

async def _find_filing_accession(
    cik: str, ticker: str, quarter: str, filing_type: str
) -> str | None:
    """Return accession number for the matching 10-Q/10-K filing, or None if not filed yet."""
    url = f"https://data.sec.gov/submissions/CIK{cik}.json"
    response = await get_client().fetch(url, ticker=ticker, filing_type="submissions")
    try:
        payload = response.json()
    except (json.JSONDecodeError, ValueError) as exc:
        raise EdgarFetchError(
            ticker=ticker, filing_type="submissions", url=url, final_status=response.status_code
        ) from exc

    period_end = _quarter_to_period_end(quarter)
    period_end_dt = datetime.strptime(period_end, "%Y-%m-%d")
    cutoff_dt = period_end_dt + timedelta(days=180)

    filings_block = payload.get("filings", {})
    entries = _collect_submission_entries(filings_block.get("recent", {}))

    # Paginated files (large filers)
    for file_meta in filings_block.get("files", []):
        name = file_meta.get("name")
        if not name:
            continue
        page_url = f"https://data.sec.gov/submissions/{name}"
        page_resp = await get_client().fetch(page_url, ticker=ticker, filing_type="submissions-page")
        try:
            page_data = page_resp.json()
        except (json.JSONDecodeError, ValueError) as exc:
            raise EdgarFetchError(
                ticker=ticker, filing_type="submissions-page", url=page_url, final_status=page_resp.status_code
            ) from exc
        entries.extend(_collect_submission_entries(page_data.get("filings", {}).get("recent", {})))

    matches = []
    for entry in entries:
        if entry["form"] != filing_type:
            continue
        try:
            filing_dt = datetime.strptime(entry["filingDate"], "%Y-%m-%d")
        except ValueError:
            continue
        if period_end_dt <= filing_dt <= cutoff_dt:
            matches.append(entry)

    if not matches:
        return None

    # Return earliest filing date match (closest to period end)
    matches.sort(key=lambda x: x["filingDate"])
    return matches[0]["accessionNumber"]


def _collect_submission_entries(recent: dict) -> list[dict]:
    accessions = recent.get("accessionNumber", [])
    dates = recent.get("filingDate", [])
    forms = recent.get("form", [])
    if len({len(accessions), len(dates), len(forms)}) > 1:
        logger.warning(
            "EDGAR submissions arrays have mismatched lengths — zip will truncate",
            extra={"lengths": {"accessionNumber": len(accessions), "filingDate": len(dates), "form": len(forms)}},
        )
    return [
        {"accessionNumber": acc, "filingDate": date, "form": form}
        for acc, date, form in zip(accessions, dates, forms)
    ]


# ── Task 9: Top-level orchestrator ────────────────────────────────────────────

async def ingest_financial_actuals(ticker: str, quarter: str) -> FinancialsResult:
    """
    Fetch and parse 10-Q/10-K financial actuals for ``ticker`` and ``quarter``.

    Args:
        ticker:  US equity ticker symbol (e.g. ``"TSLA"``).
        quarter: Quarter string in canonical format ``"Q{n}-{YYYY}"`` (e.g. ``"Q3-2024"``).

    Returns:
        ``FinancialsResult`` with extracted metrics. No DB writes.
    """
    filing_type = _quarter_to_filing_type(quarter)

    try:
        cik = await resolve_cik(ticker)
    except ValueError:
        logger.error(
            "Unknown ticker — CIK resolution failed",
            extra={"ticker": ticker, "quarter": quarter},
        )
        return FinancialsResult(
            ticker=ticker, quarter=quarter, filing_type=filing_type,
            status="FETCH_ERROR", metrics=[], filing_url="",
        )
    cik_int = str(int(cik))

    try:
        accession_no = await _find_filing_accession(cik, ticker, quarter, filing_type)
    except EdgarFetchError as exc:
        logger.error(
            "Submissions fetch failed during filing lookup",
            extra={"ticker": ticker, "quarter": quarter, "error": str(exc)},
        )
        return FinancialsResult(
            ticker=ticker, quarter=quarter, filing_type=filing_type,
            status="FETCH_ERROR", metrics=[], filing_url="",
        )

    if accession_no is None:
        logger.info(
            "10-Q not yet filed",
            extra={"ticker": ticker, "quarter": quarter, "reason": "no_filing_found"},
        )
        return FinancialsResult(
            ticker=ticker,
            quarter=quarter,
            filing_type=filing_type,
            status="FILING_NOT_YET_AVAILABLE",
            metrics=[],
            filing_url="",
        )

    accession_path = accession_no.replace("-", "")
    filing_url = (
        f"https://www.sec.gov/Archives/edgar/data/{cik_int}"
        f"/{accession_path}/{accession_no}-index.htm"
    )

    try:
        xbrl_data = await _fetch_xbrl_facts(cik, ticker)
    except EdgarFetchError as exc:
        logger.error(
            "XBRL facts fetch failed",
            extra={"ticker": ticker, "quarter": quarter, "error": str(exc)},
        )
        return FinancialsResult(
            ticker=ticker,
            quarter=quarter,
            filing_type=filing_type,
            status="FETCH_ERROR",
            metrics=[],
            filing_url=filing_url,
        )

    metrics = _extract_xbrl_metrics(xbrl_data, ticker, quarter, filing_type, filing_url)

    # Guidance extraction is best-effort — never fails the overall result
    guidance_metrics = await _extract_guidance_from_html(
        cik, accession_no, ticker, quarter, filing_type, filing_url
    )
    metrics.extend(guidance_metrics)

    # yfinance supplement: fill in AMBIGUOUS or missing XBRL metrics
    expected_metrics = set(XBRL_METRIC_CONCEPTS.keys())
    edgar_success = {m.metric_name for m in metrics if m.parse_status == "SUCCESS"}
    ambiguous = {m.metric_name for m in metrics if m.parse_status == "AMBIGUOUS" and m.metric_name in expected_metrics}
    missing = expected_metrics - {m.metric_name for m in metrics}
    supplement_targets = list(ambiguous | missing)

    if supplement_targets:
        yf_metrics = await supplement_with_yfinance(ticker, quarter, supplement_targets)
        yf_added_names = {m.metric_name for m in yf_metrics if m.metric_name not in edgar_success}
        metrics = [m for m in metrics if not (m.metric_name in yf_added_names and m.parse_status == "AMBIGUOUS")]
        for yf_metric in yf_metrics:
            if yf_metric.metric_name not in edgar_success:
                metrics.append(yf_metric)

    if not metrics:
        result_status = "PARTIAL"
    elif any(m.parse_status == "AMBIGUOUS" for m in metrics):
        result_status = "PARTIAL"
    else:
        result_status = "SUCCESS"

    logger.info(
        "financial actuals ingestion complete",
        extra={
            "ticker": ticker,
            "quarter": quarter,
            "filing_type": filing_type,
            "status": result_status,
            "metrics_count": len(metrics),
        },
    )

    return FinancialsResult(
        ticker=ticker,
        quarter=quarter,
        filing_type=filing_type,
        status=result_status,
        metrics=metrics,
        filing_url=filing_url,
    )
