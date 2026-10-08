from __future__ import annotations

import json
import logging
from collections.abc import AsyncGenerator, Mapping, Sequence
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Final

from fastapi import FastAPI, Request  # type: ignore
from fastapi.exceptions import RequestValidationError  # type: ignore
from fastapi.responses import JSONResponse  # type: ignore

from api import estimate, experiment, health, plan, sensing, simulate
from api.deps import SolverRuntime, solver_version
from app.core.types import DomainInvariantError, NonIdentifiableError
from app.settings import Settings, get_settings

LOGGER_NAME: Final = "sera.solver"
DOMAIN_ERROR_CODE: Final = "DOMAIN_INVARIANT"
NON_IDENTIFIABLE_ERROR_CODE: Final = "NON_IDENTIFIABLE"
VALIDATION_ERROR_CODE: Final = "VALIDATION"
INTERNAL_ERROR_CODE: Final = "INTERNAL"
MAX_ERROR_DETAILS: Final = 5

_LOG = logging.getLogger(LOGGER_NAME)


class _JsonLogFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, object] = {
            "ts": datetime.fromtimestamp(record.created, tz=UTC).isoformat().replace("+00:00", "Z"),
            "level": record.levelname.lower(),
            "logger": record.name,
            "msg": record.getMessage(),
        }
        if record.exc_info is not None:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


def _configure_logging(settings: Settings) -> None:
    level = logging.getLevelNamesMapping()[settings.log_level.upper()]
    if settings.log_format == "json":
        handler = logging.StreamHandler()
        handler.setFormatter(_JsonLogFormatter())
        logging.basicConfig(level=level, handlers=[handler], force=True)
        return
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)-8s %(name)s %(message)s",
        force=True,
    )


def _error_body(code: str, message: str) -> dict[str, object]:
    return {"detail": message, "error": {"code": code, "message": message}}


def _locations(error: Mapping[str, object]) -> tuple[object, ...]:
    location = error.get("loc")
    if isinstance(location, Sequence) and not isinstance(location, (str, bytes)):
        return tuple(location)
    return ()


def _validation_message(errors: Sequence[Mapping[str, object]]) -> str:
    parts: list[str] = []
    for error in errors[:MAX_ERROR_DETAILS]:
        location = ".".join(str(item) for item in _locations(error))
        message = error.get("msg")
        parts.append(f"{location}: {message if isinstance(message, str) else 'invalid'}")
    return "; ".join(parts) if parts else "request validation failed"


def _register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(DomainInvariantError)
    async def _domain_invariant(_: Request, exc: DomainInvariantError) -> JSONResponse:
        return JSONResponse(status_code=422, content=_error_body(DOMAIN_ERROR_CODE, str(exc)))

    @app.exception_handler(NonIdentifiableError)
    async def _non_identifiable(_: Request, exc: NonIdentifiableError) -> JSONResponse:
        return JSONResponse(
            status_code=422, content=_error_body(NON_IDENTIFIABLE_ERROR_CODE, str(exc))
        )

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content=_error_body(VALIDATION_ERROR_CODE, _validation_message(exc.errors())),
        )

    @app.exception_handler(Exception)
    async def _internal(_: Request, exc: Exception) -> JSONResponse:
        _LOG.error("unhandled solver error: %s", type(exc).__name__, exc_info=exc)
        return JSONResponse(
            status_code=500,
            content=_error_body(INTERNAL_ERROR_CODE, "internal solver error"),
        )


def _register_routes(app: FastAPI) -> None:
    app.include_router(health.router)
    app.include_router(simulate.router)
    app.include_router(estimate.router)
    app.include_router(plan.router)
    app.include_router(sensing.router)
    app.include_router(experiment.router)


def create_app() -> FastAPI:
    settings = get_settings()
    _configure_logging(settings)

    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncGenerator[None]:
        runtime = SolverRuntime.create(settings)
        application.state.runtime = runtime
        _LOG.info("solver runtime started")
        try:
            yield
        finally:
            runtime.shutdown()
            _LOG.info("solver runtime stopped")

    application = FastAPI(
        title="SERA Solver",
        version=solver_version(),
        summary="Sparse-sensing equitable rolling allocation engine for tertiary irrigation",
        lifespan=lifespan,
        docs_url="/docs",
        openapi_url="/openapi.json",
        redoc_url=None,
    )
    _register_error_handlers(application)
    _register_routes(application)
    return application


app = create_app()
