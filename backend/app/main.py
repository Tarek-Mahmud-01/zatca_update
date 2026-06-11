import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings

settings = get_settings()

_APPS = [
    "auth", "users", "branches", "currencies", "organizations", "business",
    "customers", "products", "categories", "invoices", "onboarding",
    "notifications", "settings", "dashboard", "account", "finance",
    "crypto",
]


async def _init_db() -> None:
    """Create all tables (if not exist) and seed a demo user on first run."""
    import app.db.registry  # noqa — registers all model classes with Base.metadata
    from app.db.base import Base
    from app.db.session import SessionLocal, engine
    from sqlalchemy import func, select

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # Seed demo tenant + admin user when the database is empty.
    async with SessionLocal() as db:
        from apps.auth.models import Tenant, TenantUser
        from app.security import hash_password
        count = (await db.execute(select(func.count()).select_from(TenantUser))).scalar()
        if count == 0:
            tenant = Tenant(
                name="Demo Tenant",
                vat_number="300000000000003",
                organization_identifier="300000000000003",
            )
            db.add(tenant)
            await db.flush()
            db.add(TenantUser(
                tenant_id=tenant.id,
                email="admin@demo.local",
                hashed_password=hash_password("ChangeMe123!"),
                role="admin",
            ))
            await db.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await _init_db()

    cfg = get_settings()
    task = None
    if cfg.enable_inproc_tick:
        try:
            from apps.invoices.workers import run_inproc_tick
            stop = asyncio.Event()
            task = asyncio.create_task(run_inproc_tick(stop))
        except ImportError:
            pass
    try:
        yield
    finally:
        if task is not None:
            stop.set()
            try:
                await asyncio.wait_for(task, timeout=2.0)
            except asyncio.TimeoutError:
                task.cancel()


app = FastAPI(title="ZATCA Phase 2 API", version="0.1.0", lifespan=lifespan)

# Payload encryption must wrap CORS so encrypted requests are decrypted
# before the route handler sees them and responses are encrypted on the way out.
from app.middleware.encryption import PayloadEncryptionMiddleware  # noqa: E402
app.add_middleware(PayloadEncryptionMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_origin_regex=settings.cors_allow_origin_regex or None,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Encrypted"],
)

for _app_name in _APPS:
    try:
        import importlib
        mod = importlib.import_module(f"apps.{_app_name}.urls")
        app.include_router(mod.router, prefix="/api/v1")
    except (ImportError, AttributeError):
        pass


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}
