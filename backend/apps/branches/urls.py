from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import select, update

from app.deps import CurrentUserDep, DbSession
from apps.branches.models import TenantBranch
from apps.branches.schemas import BranchCreate, BranchRead, BranchUpdate

router = APIRouter(prefix="/branches", tags=["branches"])


@router.get("", response_model=list[BranchRead])
async def list_branches(
    user: CurrentUserDep,
    db: DbSession,
    org: UUID | None = Query(default=None, description="Filter by organization_id"),
):
    stmt = (
        select(TenantBranch)
        .where(TenantBranch.tenant_id == user.tenant_id)
        .order_by(TenantBranch.name)
    )
    if org is not None:
        stmt = stmt.where(TenantBranch.organization_id == org)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.post("", response_model=BranchRead, status_code=status.HTTP_201_CREATED)
async def create_branch(payload: BranchCreate, user: CurrentUserDep, db: DbSession):
    if payload.is_default:
        await db.execute(
            update(TenantBranch)
            .where(
                TenantBranch.tenant_id == user.tenant_id,
                TenantBranch.organization_id == payload.organization_id,
                TenantBranch.is_default.is_(True),
            )
            .values(is_default=False)
        )

    branch = TenantBranch(
        tenant_id=user.tenant_id,
        organization_id=payload.organization_id,
        name=payload.name,
        code=payload.code,
        street=payload.street,
        building_number=payload.building_number,
        city_subdivision=payload.city_subdivision,
        city=payload.city,
        postal_zone=payload.postal_zone,
        country_code=payload.country_code,
        is_default=payload.is_default,
    )
    db.add(branch)
    await db.commit()
    await db.refresh(branch)
    return branch


@router.get("/{id}", response_model=BranchRead)
async def get_branch(id: UUID, user: CurrentUserDep, db: DbSession):
    result = await db.execute(
        select(TenantBranch).where(
            TenantBranch.id == id,
            TenantBranch.tenant_id == user.tenant_id,
        )
    )
    branch = result.scalar_one_or_none()
    if branch is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Branch not found")
    return branch


@router.patch("/{id}", response_model=BranchRead)
async def update_branch(
    id: UUID, payload: BranchUpdate, user: CurrentUserDep, db: DbSession
):
    result = await db.execute(
        select(TenantBranch).where(
            TenantBranch.id == id,
            TenantBranch.tenant_id == user.tenant_id,
        )
    )
    branch = result.scalar_one_or_none()
    if branch is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Branch not found")

    if payload.is_default is True:
        await db.execute(
            update(TenantBranch)
            .where(
                TenantBranch.tenant_id == user.tenant_id,
                TenantBranch.organization_id == branch.organization_id,
                TenantBranch.is_default.is_(True),
                TenantBranch.id != id,
            )
            .values(is_default=False)
        )

    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(branch, field, value)

    await db.commit()
    await db.refresh(branch)
    return branch


@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_branch(id: UUID, user: CurrentUserDep, db: DbSession):
    result = await db.execute(
        select(TenantBranch).where(
            TenantBranch.id == id,
            TenantBranch.tenant_id == user.tenant_id,
        )
    )
    branch = result.scalar_one_or_none()
    if branch is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Branch not found")

    await db.delete(branch)
    await db.commit()
