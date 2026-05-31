"""Tests for get_executive_at_date query helper — story 3.8."""
from unittest.mock import AsyncMock, patch

import pytest

from src.db.queries import get_executive_at_date


_EXECUTIVE_ROW = {
    "id": "a1b2c3d4-0000-0000-0000-000000000001",
    "person_name": "Tim Cook",
    "role": "CEO",
    "start_date": "2011-08-24",
    "end_date": None,
}


async def test_get_executive_at_date_found():
    """Returns the matching record when an executive holds the role on the queried date."""
    mock_pool = AsyncMock()
    mock_pool.fetchrow = AsyncMock(return_value=_EXECUTIVE_ROW)
    with patch("src.db.queries.get_pool", return_value=mock_pool):
        result = await get_executive_at_date("AAPL", "CEO", "2024-10-01")
    assert result is not None
    assert result["person_name"] == "Tim Cook"
    assert result["role"] == "CEO"


async def test_get_executive_at_date_not_found():
    """Returns None when no executive holds the role on the queried date."""
    mock_pool = AsyncMock()
    mock_pool.fetchrow = AsyncMock(return_value=None)
    with patch("src.db.queries.get_pool", return_value=mock_pool):
        result = await get_executive_at_date("AAPL", "CEO", "2005-01-01")
    assert result is None


async def test_get_executive_at_date_query_passes_correct_params():
    """fetchrow is called with ticker, role, and date as positional args in correct order."""
    mock_pool = AsyncMock()
    mock_pool.fetchrow = AsyncMock(return_value=None)
    with patch("src.db.queries.get_pool", return_value=mock_pool):
        await get_executive_at_date("TSLA", "CFO", "2023-06-15")
    mock_pool.fetchrow.assert_called_once()
    call_args = mock_pool.fetchrow.call_args
    positional = call_args.args
    # args[0] is the SQL string; args[1], [2], [3] are ticker, role, date
    assert positional[1] == "TSLA"
    assert positional[2] == "CFO"
    assert positional[3] == "2023-06-15"
