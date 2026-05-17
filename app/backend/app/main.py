from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1 import auth as auth_router
from app.api.v1 import catalog as catalog_router
from app.api.v1 import events as events_router
from app.api.v1 import invoices as invoices_router
from app.api.v1 import onboarding as onboarding_router
from app.api.v1 import settings as settings_router
from app.api.v1 import tenant_users as tenant_users_router
from app.config import get_settings

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield


app = FastAPI(
    title="ZATCA Phase 2 API",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router.router, prefix="/api/v1")
app.include_router(onboarding_router.router, prefix="/api/v1")
app.include_router(invoices_router.router, prefix="/api/v1")
app.include_router(catalog_router.router, prefix="/api/v1")
app.include_router(tenant_users_router.router, prefix="/api/v1")
app.include_router(settings_router.router, prefix="/api/v1")
app.include_router(events_router.router, prefix="/api/v1")


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}
