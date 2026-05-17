from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, EmailStr
from sqlalchemy import select

from app.db.models import Tenant, TenantUser
from app.deps import CurrentUserDep, DbSession
from app.security import create_access_token, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


class SignupRequest(BaseModel):
    tenant_name: str
    vat_number: str
    organization_identifier: str
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


@router.post("/signup", response_model=TokenResponse)
async def signup(req: SignupRequest, db: DbSession) -> TokenResponse:
    existing = await db.scalar(select(Tenant).where(Tenant.vat_number == req.vat_number))
    if existing is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "vat_number_taken")

    tenant = Tenant(
        name=req.tenant_name,
        vat_number=req.vat_number,
        organization_identifier=req.organization_identifier,
    )
    db.add(tenant)
    await db.flush()

    user = TenantUser(
        tenant_id=tenant.id,
        email=req.email,
        hashed_password=hash_password(req.password),
        role="admin",
    )
    db.add(user)
    await db.commit()

    token = create_access_token(user.id, tenant.id, user.role)
    return TokenResponse(access_token=token)


class MeResponse(BaseModel):
    user_id: str
    email: str
    role: str
    tenant_id: str
    tenant_name: str
    vat_number: str
    organization_identifier: str


@router.get("/me", response_model=MeResponse)
async def get_me(user: CurrentUserDep, db: DbSession) -> MeResponse:
    tenant = await db.scalar(select(Tenant).where(Tenant.id == user.tenant_id))
    tenant_user = await db.scalar(select(TenantUser).where(TenantUser.id == user.user_id))
    if tenant is None or tenant_user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "not_found")
    return MeResponse(
        user_id=str(tenant_user.id),
        email=tenant_user.email,
        role=tenant_user.role,
        tenant_id=str(tenant.id),
        tenant_name=tenant.name,
        vat_number=tenant.vat_number,
        organization_identifier=tenant.organization_identifier,
    )


@router.post("/login", response_model=TokenResponse)
async def login(
    form: Annotated[OAuth2PasswordRequestForm, Depends()],
    db: DbSession,
) -> TokenResponse:
    user = await db.scalar(select(TenantUser).where(TenantUser.email == form.username))
    if user is None or not verify_password(form.password, user.hashed_password):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid_credentials")
    token = create_access_token(user.id, user.tenant_id, user.role)
    return TokenResponse(access_token=token)
