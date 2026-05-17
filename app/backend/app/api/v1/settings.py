"""Tenant-level settings (queue strategy, schedule).

The queue model has two scheduling modes (selected via ``queue_schedule_mode``):

* ``times`` — release at every ``HH:MM`` listed in ``queue_schedule_times``.
* ``interval`` — release every ``queue_schedule_interval_minutes`` minutes,
  anchored at 00:00 UTC. ``5`` = every five minutes, ``120`` = every two hours.

Both modes drain the *entire* queue per fire — there is no per-tick cap.
"""
from __future__ import annotations

import re

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select

from app.db.models import Tenant
from app.db.models.tenant import DEFAULT_QUEUE_SCHEDULE_TIMES
from app.deps import CurrentUserDep, DbSession

router = APIRouter(prefix="/settings", tags=["settings"])

_HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
_MIN_INTERVAL = 1
_MAX_INTERVAL = 24 * 60  # one day


class TenantSettingsOut(BaseModel):
    queue_strategy: str = Field(description='Either "immediate" or "queued".')
    queue_schedule_mode: str = Field(description='Either "times" or "interval".')
    queue_schedule_times: list[str] = Field(
        description='List of "HH:MM" 24h release times (UTC). Used when mode="times".',
    )
    queue_schedule_interval_minutes: int = Field(
        description='Minutes between releases when mode="interval". '
                    f'Between {_MIN_INTERVAL} and {_MAX_INTERVAL}.',
    )
    # Kept for backward compatibility; no longer read by the queue logic.
    queue_throttle_per_minute: int


class TenantSettingsIn(BaseModel):
    queue_strategy: str = Field(pattern="^(immediate|queued)$")
    queue_schedule_mode: str = Field(default="times", pattern="^(times|interval)$")
    queue_schedule_times: list[str] = Field(
        default_factory=lambda: list(DEFAULT_QUEUE_SCHEDULE_TIMES),
        max_length=24,
    )
    queue_schedule_interval_minutes: int = Field(
        default=60, ge=_MIN_INTERVAL, le=_MAX_INTERVAL,
    )

    @field_validator("queue_schedule_times")
    @classmethod
    def _valid_times(cls, v: list[str]) -> list[str]:
        cleaned: list[str] = []
        for raw in v:
            s = (raw or "").strip()
            if not _HHMM.match(s):
                raise ValueError(f"invalid_time: {raw!r}, expected HH:MM 24h")
            if s not in cleaned:
                cleaned.append(s)
        cleaned.sort()
        return cleaned

    def model_post_init(self, __context) -> None:
        # Mode-specific sanity: only enforce non-empty times when the active
        # mode actually needs them. Interval mode tolerates an empty times list.
        if self.queue_schedule_mode == "times" and not self.queue_schedule_times:
            raise ValueError("queue_schedule_times: at least one time required when mode='times'")


def _out(t: Tenant) -> TenantSettingsOut:
    times_raw = getattr(t, "queue_schedule_times", None)
    times = list(times_raw) if isinstance(times_raw, list) and times_raw else list(DEFAULT_QUEUE_SCHEDULE_TIMES)
    mode = getattr(t, "queue_schedule_mode", None) or "times"
    interval = int(getattr(t, "queue_schedule_interval_minutes", None) or 60)
    throttle = int(getattr(t, "queue_throttle_per_minute", None) or 60)
    return TenantSettingsOut(
        queue_strategy=t.queue_strategy,
        queue_schedule_mode=mode,
        queue_schedule_times=times,
        queue_schedule_interval_minutes=interval,
        queue_throttle_per_minute=throttle,
    )


@router.get("/tenant", response_model=TenantSettingsOut)
async def get_tenant_settings(user: CurrentUserDep, db: DbSession) -> TenantSettingsOut:
    t = await db.scalar(select(Tenant).where(Tenant.id == user.tenant_id))
    if t is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "tenant_missing")
    return _out(t)


@router.put("/tenant", response_model=TenantSettingsOut)
async def put_tenant_settings(
    body: TenantSettingsIn, user: CurrentUserDep, db: DbSession,
) -> TenantSettingsOut:
    if user.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "admin_role_required")
    t = await db.scalar(select(Tenant).where(Tenant.id == user.tenant_id))
    if t is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "tenant_missing")
    t.queue_strategy = body.queue_strategy
    t.queue_schedule_mode = body.queue_schedule_mode
    t.queue_schedule_times = body.queue_schedule_times
    t.queue_schedule_interval_minutes = body.queue_schedule_interval_minutes
    await db.commit()
    await db.refresh(t)
    return _out(t)


# ---------------------------------------------------------------------------
# Business profile — tenant identity used on every invoice
# ---------------------------------------------------------------------------


_ISO_CURRENCY = re.compile(r"^[A-Z]{3}$")


class BusinessSettingsOut(BaseModel):
    tenant_id: str
    name: str = Field(description="Legal entity name. Set at signup; not editable here.")
    vat_number: str
    organization_identifier: str
    currency: str = Field(description="ISO 4217 currency code, e.g. SAR.")
    trade_name: str | None = Field(
        description="Display/marketing name. Falls back to the legal name when empty.",
    )
    branch_name: str | None = Field(
        description="Branch/location identifier for multi-branch tenants.",
    )


class BusinessSettingsIn(BaseModel):
    currency: str = Field(default="SAR", min_length=3, max_length=3)
    trade_name: str | None = Field(default=None, max_length=200)
    branch_name: str | None = Field(default=None, max_length=200)

    @field_validator("currency")
    @classmethod
    def _valid_currency(cls, v: str) -> str:
        s = (v or "SAR").strip().upper()
        if not _ISO_CURRENCY.match(s):
            raise ValueError("currency must be 3 uppercase ASCII letters (ISO 4217)")
        return s

    @field_validator("trade_name", "branch_name")
    @classmethod
    def _trim_optional(cls, v: str | None) -> str | None:
        if v is None:
            return None
        s = v.strip()
        return s or None


def _business_out(t: Tenant) -> BusinessSettingsOut:
    return BusinessSettingsOut(
        tenant_id=str(t.id),
        name=t.name,
        vat_number=t.vat_number,
        organization_identifier=t.organization_identifier,
        currency=(getattr(t, "currency", None) or "SAR"),
        trade_name=getattr(t, "trade_name", None),
        branch_name=getattr(t, "branch_name", None),
    )


@router.get("/business", response_model=BusinessSettingsOut)
async def get_business_settings(user: CurrentUserDep, db: DbSession) -> BusinessSettingsOut:
    t = await db.scalar(select(Tenant).where(Tenant.id == user.tenant_id))
    if t is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "tenant_missing")
    return _business_out(t)


@router.put("/business", response_model=BusinessSettingsOut)
async def put_business_settings(
    body: BusinessSettingsIn, user: CurrentUserDep, db: DbSession,
) -> BusinessSettingsOut:
    if user.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "admin_role_required")
    t = await db.scalar(select(Tenant).where(Tenant.id == user.tenant_id))
    if t is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "tenant_missing")
    t.currency = body.currency
    t.trade_name = body.trade_name
    t.branch_name = body.branch_name
    await db.commit()
    await db.refresh(t)
    return _business_out(t)
