"""Tenant team-member management — list + invite + update role + delete."""
from __future__ import annotations

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import asc, select

from app.db.models import TenantBranch, TenantUser
from app.deps import CurrentUserDep, DbSession
from app.security import hash_password

router = APIRouter(prefix="/tenant-users", tags=["tenant-users"])


class TenantUserOut(BaseModel):
    id: UUID
    email: str
    role: str
    created_at: datetime
    is_me: bool
    default_branch_id: UUID | None


class InviteIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    role: str = Field(default="member", pattern="^(admin|member|viewer)$")
    default_branch_id: UUID | None = None


class UpdateUserIn(BaseModel):
    # Both optional — PATCH only changes provided fields.
    role: str | None = Field(default=None, pattern="^(admin|member|viewer)$")
    # Pass null to clear; omit the key to leave unchanged.
    default_branch_id: UUID | None | str = Field(default="__unset__")


async def _check_branch_owned(db, tenant_id: UUID, branch_id: UUID | None) -> None:
    if branch_id is None:
        return
    row = await db.scalar(
        select(TenantBranch).where(
            TenantBranch.id == branch_id, TenantBranch.tenant_id == tenant_id,
        )
    )
    if row is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "branch_not_in_tenant")


def _to_out(row: TenantUser, *, is_me: bool) -> TenantUserOut:
    return TenantUserOut(
        id=row.id, email=row.email, role=row.role,
        created_at=row.created_at, is_me=is_me,
        default_branch_id=row.default_branch_id,
    )


def _require_admin(user) -> None:
    if user.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "admin_role_required")


@router.get("", response_model=list[TenantUserOut])
async def list_team(user: CurrentUserDep, db: DbSession) -> list[TenantUserOut]:
    rows = (
        await db.execute(
            select(TenantUser)
            .where(TenantUser.tenant_id == user.tenant_id)
            .order_by(asc(TenantUser.created_at))
        )
    ).scalars().all()
    return [_to_out(r, is_me=(r.id == user.user_id)) for r in rows]


@router.post("", response_model=TenantUserOut, status_code=status.HTTP_201_CREATED)
async def invite_user(body: InviteIn, user: CurrentUserDep, db: DbSession) -> TenantUserOut:
    _require_admin(user)
    existing = await db.scalar(
        select(TenantUser).where(
            TenantUser.tenant_id == user.tenant_id, TenantUser.email == body.email
        )
    )
    if existing is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "email_taken")
    await _check_branch_owned(db, user.tenant_id, body.default_branch_id)
    row = TenantUser(
        tenant_id=user.tenant_id,
        email=body.email,
        hashed_password=hash_password(body.password),
        role=body.role,
        default_branch_id=body.default_branch_id,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return _to_out(row, is_me=False)


@router.patch("/{user_id}", response_model=TenantUserOut)
async def update_user(
    user_id: UUID, body: UpdateUserIn, user: CurrentUserDep, db: DbSession
) -> TenantUserOut:
    _require_admin(user)
    row = await db.scalar(
        select(TenantUser).where(TenantUser.id == user_id, TenantUser.tenant_id == user.tenant_id)
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "not_found")
    if body.role is not None:
        if row.id == user.user_id and body.role != "admin":
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "cannot_demote_self")
        row.role = body.role
    # Sentinel — only touch the field if the caller explicitly sent it.
    if body.default_branch_id != "__unset__":
        bid = body.default_branch_id  # may be UUID or None
        await _check_branch_owned(db, user.tenant_id, bid if isinstance(bid, UUID) else None)
        row.default_branch_id = bid if isinstance(bid, UUID) else None
    await db.commit()
    await db.refresh(row)
    return _to_out(row, is_me=(row.id == user.user_id))


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_user(user_id: UUID, user: CurrentUserDep, db: DbSession) -> None:
    _require_admin(user)
    row = await db.scalar(
        select(TenantUser).where(TenantUser.id == user_id, TenantUser.tenant_id == user.tenant_id)
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "not_found")
    if row.id == user.user_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "cannot_remove_self")
    await db.delete(row)
    await db.commit()
