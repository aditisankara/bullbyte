from pydantic import BaseModel


class EdgarFetchError(Exception):
    def __init__(self, ticker: str, filing_type: str, url: str, final_status: int) -> None:
        self.ticker = ticker
        self.filing_type = filing_type
        self.url = url
        self.final_status = final_status
        super().__init__(f"EDGAR fetch failed for {ticker}/{filing_type} — status {final_status}")


class EdgarFetchLog(BaseModel):
    ticker: str
    filing_type: str
    url: str
    status: int
    attempt_number: int
    service: str
    timestamp: str
