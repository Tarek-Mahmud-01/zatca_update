from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps import CurrentUserDep
from apps.onboarding.schemas import CsrConfigCreate, CsrConfigRead, ComplianceRequest
from apps.onboarding.service import OnboardingService

router = APIRouter(prefix="/onboarding", tags=["onboarding"])


@router.post("/csr-config", response_model=CsrConfigRead, status_code=201)
async def save_csr_config(
    body: CsrConfigCreate,
    user: CurrentUserDep,
    db: AsyncSession = Depends(get_db),
):
    return await OnboardingService(db).save_csr_config(user.tenant_id, body.model_dump())


@router.post("/compliance")
async def request_compliance(
    body: ComplianceRequest,
    user: CurrentUserDep,
    db: AsyncSession = Depends(get_db),
):
    try:
        return await OnboardingService(db).request_compliance_csid(user.tenant_id, body.env, body.otp)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@router.post("/production")
async def request_production(
    body: ComplianceRequest,
    user: CurrentUserDep,
    db: AsyncSession = Depends(get_db),
):
    try:
        return await OnboardingService(db).request_production_csid(user.tenant_id, body.env)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@router.get("/status")
async def get_status(
    user: CurrentUserDep,
    db: AsyncSession = Depends(get_db),
    env: str = "sandbox",
):
    return await OnboardingService(db).get_status(user.tenant_id, env)
