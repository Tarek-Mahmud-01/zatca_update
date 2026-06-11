from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps import CurrentUserDep
from apps.auth.models import Tenant, TenantUser

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


class UserPreferencesUpdate(BaseModel):
    page_size: int | None = None
    reported_daily_quota: int | None = None
    clearance_daily_quota: int | None = None


def _tenant_dict(tenant: Tenant) -> dict:
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


@router.get("/tenant")
async def get_tenant_settings(
    user: CurrentUserDep,
    db: AsyncSession = Depends(get_db),
) -> dict:
    result = await db.execute(select(Tenant).where(Tenant.id == user.tenant_id))
    tenant = result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(404, "tenant_not_found")
    return _tenant_dict(tenant)


@router.patch("/tenant")
async def patch_tenant_settings(
    body: TenantSettingsUpdate,
    user: CurrentUserDep,
    db: AsyncSession = Depends(get_db),
) -> dict:
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(400, "no_fields_to_update")
    await db.execute(update(Tenant).where(Tenant.id == user.tenant_id).values(**updates))
    await db.commit()
    return await get_tenant_settings(user, db)


@router.put("/tenant")
async def put_tenant_settings(
    body: TenantSettingsUpdate,
    user: CurrentUserDep,
    db: AsyncSession = Depends(get_db),
) -> dict:
    updates = body.model_dump(exclude_none=True)
    if updates:
        await db.execute(update(Tenant).where(Tenant.id == user.tenant_id).values(**updates))
        await db.commit()
    return await get_tenant_settings(user, db)


@router.get("/user-preferences")
async def get_user_preferences(
    user: CurrentUserDep,
    db: AsyncSession = Depends(get_db),
) -> dict:
    result = await db.execute(
        select(TenantUser).where(TenantUser.id == user.user_id)
    )
    tu = result.scalar_one_or_none()
    if not tu:
        raise HTTPException(404, "user_not_found")
    return {
        "page_size": tu.page_size,
        "reported_daily_quota": tu.reported_daily_quota,
        "clearance_daily_quota": tu.clearance_daily_quota,
        "updated_at": tu.updated_at.isoformat() if tu.updated_at else datetime.utcnow().isoformat(),
    }


@router.put("/user-preferences")
async def put_user_preferences(
    body: UserPreferencesUpdate,
    user: CurrentUserDep,
    db: AsyncSession = Depends(get_db),
) -> dict:
    updates = body.model_dump(exclude_none=True)
    if updates:
        await db.execute(
            update(TenantUser).where(TenantUser.id == user.user_id).values(**updates)
        )
        await db.commit()
    return await get_user_preferences(user, db)
