from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps import CurrentUserDep
from app.exceptions import AuthenticationError, ConflictError
from apps.auth.schemas import LoginRequest, SignupRequest, TokenResponse
from apps.auth.service import AuthService

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)) -> dict:
    try:
        return await AuthService(db).login(body.email, body.password, remember_me=body.remember_me)
    except AuthenticationError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail=exc.message)


@router.post("/signup", response_model=TokenResponse, status_code=201)
async def signup(body: SignupRequest, db: AsyncSession = Depends(get_db)) -> dict:
    try:
        return await AuthService(db).signup(
            tenant_name=body.tenant_name,
            vat_number=body.vat_number,
            organization_identifier=body.organization_identifier,
            email=body.email,
            password=body.password,
        )
    except ConflictError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=exc.message)


@router.get("/me")
async def me(user: CurrentUserDep, db: AsyncSession = Depends(get_db)) -> dict:
    from sqlalchemy import select
    from apps.auth.models import Tenant, TenantUser
    result = await db.execute(select(TenantUser).where(TenantUser.id == user.user_id))
    db_user = result.scalar_one_or_none()
    if not db_user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "user_not_found")
    tenant = await db.get(Tenant, user.tenant_id)
    return {
        "user_id": str(user.user_id),
        "email": db_user.email,
        "role": user.role,
        "tenant_id": str(user.tenant_id),
        "tenant_name": tenant.name if tenant else "",
        "vat_number": tenant.vat_number if tenant else "",
        "organization_identifier": tenant.organization_identifier if tenant else "",
        "default_branch_id": str(db_user.default_branch_id) if db_user.default_branch_id else None,
    }
