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

    database_url: str = "postgresql+asyncpg://postgres:postgres@127.0.0.1:5433/zatca"
    redis_url: str = "redis://localhost:6379/0"

    zatca_sandbox_base_url: str = "https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal"
    zatca_simulation_base_url: str = "https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation"
    zatca_production_base_url: str = "https://gw-fatoora.zatca.gov.sa/e-invoicing/core"

    jwt_algorithm: str = "HS256"
    jwt_expires_minutes: int = 720
    sse_ticket_ttl_seconds: int = 60
    rate_limit_per_second: int = 50

    worker_concurrency: int = 50
    worker_job_timeout: int = 120
    enable_inproc_tick: bool = True

    cors_allow_origins: str = ""
    cors_allow_origin_regex: str = r"https?://(localhost|127\.0\.0\.1)(:\d+)?"

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_allow_origins.split(",") if o.strip()]

    @property
    def assets_dir(self) -> Path:
        return Path(__file__).resolve().parent.parent / "apps" / "zatca" / "assets"

    def zatca_base_url(self, env: ZatcaEnv) -> str:
        return {
            ZatcaEnv.sandbox: self.zatca_sandbox_base_url,
            ZatcaEnv.simulation: self.zatca_simulation_base_url,
            ZatcaEnv.production: self.zatca_production_base_url,
        }[env]


@lru_cache
def get_settings() -> Settings:
    return Settings()
