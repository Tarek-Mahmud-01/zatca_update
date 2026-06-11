from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from uuid import UUID
from pydantic import BaseModel
from typing import Any
from app.db.session import get_db
from app.deps import CurrentUserDep
from apps.auth.models import Tenant

router = APIRouter(prefix="/settings", tags=["settings"])

class TenantSettingsUpdate(BaseModel):
    currency: str | None = None
    trade_name: str | None = None
    branch_name: str | None = None
    queue_strategy: str | None = None
    queue_throttle_per_minute: int | None = None
    queue_schedule_mode: str | None = None
    queue_schedule_times: list[str] | None = None
    queue_schedule_interval_minutes: int | None = None

@router.get("/tenant")
async def get_tenant_settings(user: CurrentUserDep, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Tenant).where(Tenant.id == user.tenant_id))
    tenant = result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(404, "tenant_not_found")
    return {
        "id": str(tenant.id),
        "name": tenant.name,
        "vat_number": tenant.vat_number,
        "organization_identifier": tenant.organization_identifier,
        "currency": tenant.currency,
        "trade_name": tenant.trade_name,
        "branch_name": tenant.branch_name,
        "queue_strategy": tenant.queue_strategy,
        "queue_throttle_per_minute": tenant.queue_throttle_per_minute,
        "queue_schedule_mode": tenant.queue_schedule_mode,
        "queue_schedule_times": tenant.queue_schedule_times,
        "queue_schedule_interval_minutes": tenant.queue_schedule_interval_minutes,
    }

@router.patch("/tenant")
async def update_tenant_settings(body: TenantSettingsUpdate, user: CurrentUserDep, db: AsyncSession = Depends(get_db)):
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(400, "no_fields_to_update")
    await db.execute(update(Tenant).where(Tenant.id == user.tenant_id).values(**updates))
    await db.commit()
    return await get_tenant_settings(user, db)
