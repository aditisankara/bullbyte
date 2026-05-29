
from typing import Literal

from pydantic import BaseModel

# Status of the parsing process for a given transcript
ParseStatus = Literal["SUCCESS", "PRESS_RELEASE", "PARSE_FAILURE", "NO_TRANSCRIPT", "FETCH_ERROR"]

class TranscriptResult(BaseModel):
    """Model representing the result of parsing a transcript."""
    ticker: str
    quarter: str
    filing_date: str
    raw_text: str  # empty string ("") when parse_status is not SUCCESS
    filing_url: str
    parse_status: ParseStatus

class IngestionSummary(BaseModel):
    """Aggregate result of an 8-K ingestion run for a single ticker and date range."""
    ticker: str
    date_range_start: str
    date_range_end: str
    total_8k_found: int
    transcripts_extracted: int
    press_releases_extracted: int = 0
    skipped_no_transcript: int
    parse_failures: int
    fetch_errors: int
    results: list[TranscriptResult]
