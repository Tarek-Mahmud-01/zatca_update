from enum import Enum
from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class ZatcaEnv(str, Enum):
    sandbox = "sandbox"
    simulation = "simulation"
    production = "production"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_env: str = "development"
    secret_key: str = "dev-secret-change-me"

    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/zatca"
    redis_url: str = "redis://localhost:6379/0"

    zatca_sandbox_base_url: str
    zatca_simulation_base_url: str
    zatca_production_base_url: str

    jwt_algorithm: str = "HS256"
    jwt_expires_minutes: int = 720
    rate_limit_per_second: int = 50

    # Background worker (arq, Redis-backed). ZATCA submission jobs are network-
    # bound, so a single async worker runs many concurrently — tune per-worker
    # concurrency here and scale OUT by running more worker replicas (they all
    # pull from the same Redis queue). For multi-tenant high traffic, more
    # replicas + a higher concurrency beats one fat worker.
    worker_concurrency: int = 50      # arq max_jobs per worker process
    worker_job_timeout: int = 120     # seconds allowed per submission job

    # Single-host dev runs the queue scheduler INSIDE the API process (see
    # main.py lifespan). When you run the dedicated arq worker — which has its
    # own cron — set this False so the schedule isn't drained twice. It MUST be
    # False behind multiple API workers/replicas (otherwise every replica ticks).
    enable_inproc_tick: bool = True

    # Short-lived ticket used to authenticate the SSE stream (EventSource can't
    # send an Authorization header, so the full JWT would otherwise end up in the
    # URL / access logs). The browser mints one of these per connection over an
    # authenticated POST; it only grants read access to the event stream.
    sse_ticket_ttl_seconds: int = 60

    # CORS. In dev, any localhost/127.0.0.1 port is allowed via the regex so the
    # frontend port can shift freely. In production, set CORS_ALLOW_ORIGINS to an
    # explicit comma-separated list and clear CORS_ALLOW_ORIGIN_REGEX.
    cors_allow_origins: str = ""
    cors_allow_origin_regex: str = r"https?://(localhost|127\.0\.0\.1)(:\d+)?"

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_allow_origins.split(",") if o.strip()]

    @property
    def assets_dir(self) -> Path:
        return Path(__file__).parent / "assets"

    def zatca_base_url(self, env: ZatcaEnv) -> str:
        return {
            ZatcaEnv.sandbox: self.zatca_sandbox_base_url,
            ZatcaEnv.simulation: self.zatca_simulation_base_url,
            ZatcaEnv.production: self.zatca_production_base_url,
        }[env]


@lru_cache
def get_settings() -> Settings:
    return Settings()
