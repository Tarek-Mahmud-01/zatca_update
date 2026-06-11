from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select, update as sa_update

from app.deps import CurrentUserDep, DbSession
from app.exceptions import NotFoundError
from apps.organizations.models import TenantOrganization
from apps.organizations.schemas import OrgCreate, OrgRead, OrgUpdate

router = APIRouter(prefix="/organizations", tags=["organizations"])


async def _get_org_or_404(db: DbSession, tenant_id: UUID, org_id: UUID) -> TenantOrganization:
    stmt = (
        select(TenantOrganization)
        .where(
            TenantOrganization.id == org_id,
            TenantOrganization.tenant_id == tenant_id,
        )
    )
    obj = (await db.execute(stmt)).scalar_one_or_none()
    if obj is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found.")
    return obj


async def _clear_default(db: DbSession, tenant_id: UUID) -> None:
    """Set is_default=False for all organizations belonging to this tenant."""
    await db.execute(
        sa_update(TenantOrganization)
        .where(TenantOrganization.tenant_id == tenant_id)
        .values(is_default=False)
    )


@router.get("", response_model=list[OrgRead])
async def list_organizations(
    db: DbSession,
    user: CurrentUserDep,
) -> list[TenantOrganization]:
    stmt = (
        select(TenantOrganization)
        .where(TenantOrganization.tenant_id == user.tenant_id)
        .order_by(TenantOrganization.name)
    )
    result = (await db.execute(stmt)).scalars().all()
    return list(result)


@router.post("", response_model=OrgRead, status_code=status.HTTP_201_CREATED)
async def create_organization(
    payload: OrgCreate,
    db: DbSession,
    user: CurrentUserDep,
) -> TenantOrganization:
    if payload.is_default:
        await _clear_default(db, user.tenant_id)

    org = TenantOrganization(
        tenant_id=user.tenant_id,
        **payload.model_dump(),
    )
    db.add(org)
    await db.flush()
    await db.refresh(org)
    await db.commit()
    return org


@router.get("/{org_id}", response_model=OrgRead)
async def get_organization(
    org_id: UUID,
    db: DbSession,
    user: CurrentUserDep,
) -> TenantOrganization:
    return await _get_org_or_404(db, user.tenant_id, org_id)


@router.patch("/{org_id}", response_model=OrgRead)
async def update_organization(
    org_id: UUID,
    payload: OrgUpdate,
    db: DbSession,
    user: CurrentUserDep,
) -> TenantOrganization:
    org = await _get_org_or_404(db, user.tenant_id, org_id)

    updates = payload.model_dump(exclude_unset=True)

    if updates.get("is_default"):
        await _clear_default(db, user.tenant_id)

    for field, value in updates.items():
        setattr(org, field, value)

    await db.flush()
    await db.refresh(org)
    await db.commit()
    return org


@router.delete("/{org_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_organization(
    org_id: UUID,
    db: DbSession,
    user: CurrentUserDep,
) -> None:
    org = await _get_org_or_404(db, user.tenant_id, org_id)
    await db.delete(org)
    await db.commit()
