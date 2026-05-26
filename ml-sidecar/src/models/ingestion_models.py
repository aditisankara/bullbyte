
from typing import Literal

from pydantic import BaseModel
 
# Status of the parsing process for a given transcript
ParseStatus = Literal["SUCCESS", "PARSE_FAILURE", "NO_TRANSCRIPT", "FETCH_ERROR"]

class TranscriptResult(BaseModel):
    """Model representing the result of parsing a transcript."""
    ticker: str
    quarter: str
    filing_date: str
    raw_text: str
    filing_url: str
    parse_status: ParseStatus

class IngestionSummary(BaseModel):
    """"""
    ticker: str
    date_range_start: str
    date_range_end: str
    total_8k_found: int
    transcripts_extracted: int
    skipped_no_transcript: int
    parse_failures: int
    resutls: list[TranscriptResult]


