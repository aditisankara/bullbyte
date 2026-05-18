"""Analysis router — stub endpoints for the intelligence pipeline."""

from fastapi import APIRouter
from fastapi.responses import JSONResponse

router = APIRouter()


@router.post("/analyze/{ticker}", status_code=202)
async def analyze_ticker(ticker: str) -> JSONResponse:
    return JSONResponse(
        status_code=202,
        content={"jobId": "stub", "status": "QUEUED"},
    )
