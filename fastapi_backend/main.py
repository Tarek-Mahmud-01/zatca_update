"""Application entrypoint.

The project root does ONE job: wire cross-cutting concerns (CORS, centralized
exception handling) and register each APP's base router. All path definitions
live in the apps' own urls.py — the root never declares routes itself.

Run:  uvicorn main:app --reload
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from account.urls import router as account_router
from core.config import get_settings
from core.exception_handlers import register_exception_handlers
from finance.urls import router as finance_router
from invoice.urls import router as invoices_router
from settings.urls import router as settings_router
from user.urls import router as users_router

settings = get_settings()

API_PREFIX = "/api/v1"

# Registry of app base routers. Add a new app by appending its `urls.router`.
APP_ROUTERS = (
    users_router,
    account_router,
    invoices_router,
    finance_router,
    settings_router,
)


def create_app() -> FastAPI:
    app = FastAPI(title=settings.app_name, debug=settings.debug)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    register_exception_handlers(app)

    for router in APP_ROUTERS:
        app.include_router(router, prefix=API_PREFIX)

    @app.get("/healthz", tags=["health"])
    async def healthz() -> dict:
        return {"success": True, "message": "ok", "data": {"status": "healthy"}}

    return app


app = create_app()
