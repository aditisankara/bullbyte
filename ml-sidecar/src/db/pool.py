"""asyncpg connection pool — single authority for all DB connections in the sidecar."""

import asyncio
import os
import asyncpg

_pool: asyncpg.Pool | None = None
_pool_lock = asyncio.Lock()


async def get_pool() -> asyncpg.Pool:
    """Return the shared connection pool, creating it on first call.

    Double-checked locking prevents multiple pools from being created under
    concurrent async callers at startup.
    """
    global _pool
    if _pool is None:
        async with _pool_lock:
            if _pool is None:
                _pool = await asyncpg.create_pool(
                    dsn=os.environ.get(
                        "DATABASE_URL",
                        "postgresql://postgres:postgres@db:5432/bullbyte",
                    ),
                    min_size=2,
                    max_size=10,
                )
    return _pool


async def close_pool() -> None:
    """Gracefully close the pool on shutdown."""
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None
