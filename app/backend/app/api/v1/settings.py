"""Tenant-level settings (queue strategy, throttle).

These drive how the worker releases queued invoices to ZATCA.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.db.models import Tenant
from app.deps import CurrentUserDep, DbSession

router = APIRouter(prefix="/settings", tags=["settings"])


class TenantSettingsOut(BaseModel):
    queue_strategy: str = Field(description='Either "immediate" or "queued".')
    queue_throttle_per_minute: int = Field(
        description="Max invoices released from the queue per minute when strategy=queued.",
    )


class TenantSettingsIn(BaseModel):
    queue_strategy: str = Field(pattern="^(immediate|queued)$")
    queue_throttle_per_minute: int = Field(ge=1, le=10_000)


@router.get("/tenant", response_model=TenantSettingsOut)
async def get_tenant_settings(user: CurrentUserDep, db: DbSession) -> TenantSettingsOut:
    t = await db.scalar(select(Tenant).where(Tenant.id == user.tenant_id))
    if t is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "tenant_missing")
    return TenantSettingsOut(
        queue_strategy=t.queue_strategy,
        queue_throttle_per_minute=t.queue_throttle_per_minute,
    )


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
    t.queue_throttle_per_minute = body.queue_throttle_per_minute
    await db.commit()
    await db.refresh(t)
    return TenantSettingsOut(
        queue_strategy=t.queue_strategy,
        queue_throttle_per_minute=t.queue_throttle_per_minute,
    )
