from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import HTTPException, RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from src.core.logging import get_logger
from src.db.pool import close_pool, get_pool
from src.routers.analysis_router import router as analysis_router

logger = get_logger("ml-sidecar.main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        await get_pool()
        logger.info("Database connection pool ready", extra={"service": "ml-sidecar"})
    except Exception as exc:
        logger.warning(
            "Database connection pool failed — running without DB",
            extra={"service": "ml-sidecar", "error": str(exc)},
        )
    yield
    await close_pool()
    logger.info("Database connection pool closed", extra={"service": "ml-sidecar"})


app = FastAPI(title="BullByte ML Sidecar", version="0.1.0", lifespan=lifespan)


@app.exception_handler(StarletteHTTPException)
@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": {"code": "HTTP_ERROR", "message": exc.detail}},
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content={"detail": {"code": "VALIDATION_ERROR", "message": "Request validation failed"}},
    )


@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled exception", extra={"service": "ml-sidecar"})
    return JSONResponse(
        status_code=500,
        content={"detail": {"code": "INTERNAL_ERROR", "message": "An unexpected error occurred"}},
    )


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "service": "ml-sidecar"}


app.include_router(analysis_router)
