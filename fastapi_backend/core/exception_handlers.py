"""Centralized exception handling — registered once on the FastAPI app.

Every error path (domain errors, request validation, raw HTTPException, DB
errors, uncaught exceptions) is funneled into the SAME error envelope so the
client only ever parses one shape. Views never build error responses.
"""
import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from core.config import get_settings
from core.exceptions import AppException
from core.responses import error

logger = logging.getLogger("app")


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppException)
    async def _app_exception(_: Request, exc: AppException) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=error(exc.message, code=exc.code, errors=exc.errors),
        )

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content=error("Validation failed.", code="validation_error", errors=exc.errors()),
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=error(str(exc.detail), code="http_error"),
        )

    @app.exception_handler(IntegrityError)
    async def _integrity(_: Request, exc: IntegrityError) -> JSONResponse:
        logger.warning("integrity_error: %s", exc)
        return JSONResponse(
            status_code=409,
            content=error("Resource conflict (constraint violation).", code="conflict"),
        )

    @app.exception_handler(SQLAlchemyError)
    async def _db(_: Request, exc: SQLAlchemyError) -> JSONResponse:
        logger.exception("database_error")
        return JSONResponse(
            status_code=500,
            content=error("A database error occurred.", code="database_error"),
        )

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception) -> JSONResponse:
        logger.exception("unhandled_error")
        detail = str(exc) if get_settings().debug else None
        return JSONResponse(
            status_code=500,
            content=error("Internal server error.", code="internal_error", errors=detail),
        )
