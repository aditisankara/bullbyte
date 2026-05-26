import asyncio
import os
from typing import Optional

import httpx
from tenacity import RetryError, retry, retry_if_exception, stop_after_attempt, wait_exponential

from src.core.edgar_models import EdgarFetchError
from src.core.logging import get_logger

logger = get_logger("ml-sidecar.edgar_client")

_RATE_LIMIT = 10  # max requests per second, shared across all coroutines
# Module-level semaphore: each slot is held for 1.0s, giving ≤10 req/s aggregate.
_rate_semaphore: asyncio.Semaphore = asyncio.Semaphore(_RATE_LIMIT)

_client: Optional["EdgarClient"] = None


class EdgarClient:
    def __init__(self, user_agent: str) -> None:
        if not user_agent.strip():
            raise ValueError("EDGAR_USER_AGENT environment variable must be set")
        self._user_agent = user_agent
        self._http_client = httpx.AsyncClient(
            headers={"User-Agent": user_agent},
            follow_redirects=True,
        )

    async def fetch(self, url: str, ticker: str, filing_type: str) -> httpx.Response:
        """Fetch a URL from EDGAR, rate-limited to ≤10 req/s with retry on 429/5xx."""
        await _rate_semaphore.acquire()
        asyncio.get_running_loop().call_later(1.0, _rate_semaphore.release)
        return await self._do_fetch(url, ticker, filing_type)

    async def _do_fetch(self, url: str, ticker: str, filing_type: str) -> httpx.Response:
        attempt_number = 0
        last_status = 0

        async def _attempt() -> httpx.Response:
            nonlocal attempt_number, last_status
            attempt_number += 1
            response = await self._http_client.get(url)
            last_status = response.status_code
            logger.info(
                "EDGAR fetch attempt",
                extra={
                    "ticker": ticker,
                    "filing_type": filing_type,
                    "url": url,
                    "status": response.status_code,
                    "attempt_number": attempt_number,
                },
            )
            response.raise_for_status()
            return response

        _retrying = retry(
            retry=retry_if_exception(
                lambda e: isinstance(e, httpx.HTTPStatusError)
                and e.response.status_code in (429, *range(500, 600))
            ),
            wait=wait_exponential(multiplier=1, min=1, max=30),
            stop=stop_after_attempt(3),
            reraise=False,
        )(_attempt)

        try:
            return await _retrying()
        except RetryError:
            raise EdgarFetchError(
                ticker=ticker,
                filing_type=filing_type,
                url=url,
                final_status=last_status,
            )
        except httpx.HTTPStatusError as exc:
            # Non-retried HTTP errors (e.g. 404, 403) — wrap for a consistent caller contract
            raise EdgarFetchError(
                ticker=ticker,
                filing_type=filing_type,
                url=url,
                final_status=exc.response.status_code,
            ) from exc


def get_client() -> EdgarClient:
    """Return the cached EdgarClient singleton, creating it on first call."""
    global _client
    if _client is None:
        user_agent = os.environ.get("EDGAR_USER_AGENT", "")
        _client = EdgarClient(user_agent)
    return _client


def reset_client() -> None:
    """Reset the singleton and semaphore (test helper — not for production use)."""
    global _client, _rate_semaphore
    _client = None
    _rate_semaphore = asyncio.Semaphore(_RATE_LIMIT)
