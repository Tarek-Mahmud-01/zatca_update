"""FastAPI router for ZATCA invoice issuance and submission."""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps import CurrentUserDep
from apps.invoices.models import Invoice, Submission
from apps.invoices.schemas import InvoiceCreate, InvoiceRead, InvoiceStatusCount, InvoiceStats
from apps.invoices.service import InvoiceService

router = APIRouter(prefix="/invoices", tags=["invoices"])


# ---------------------------------------------------------------------------
# GET /invoices — paginated list, optional ?status= and ?env= filters
# ---------------------------------------------------------------------------

@router.get("", response_model=list[InvoiceRead])
async def list_invoices(
    user: CurrentUserDep,
    db: AsyncSession = Depends(get_db),
    limit: int = 25,
    offset: int = 0,
    status: str | None = None,
    env: str | None = None,
) -> list[Invoice]:
    stmt = (
        select(Invoice)
        .where(Invoice.tenant_id == user.tenant_id)
        .order_by(Invoice.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    if status:
        stmt = stmt.where(Invoice.status == status)
    if env:
        stmt = stmt.where(Invoice.env == env)
    result = await db.execute(stmt)
    return list(result.scalars().all())


# ---------------------------------------------------------------------------
# GET /invoices/stats — count by status for the tenant
# ---------------------------------------------------------------------------

@router.get("/stats", response_model=InvoiceStats)
async def invoice_stats(
    user: CurrentUserDep,
    db: AsyncSession = Depends(get_db),
    env: str | None = None,
) -> InvoiceStats:
    stmt = (
        select(Invoice.status, func.count().label("count"))
        .where(Invoice.tenant_id == user.tenant_id)
        .group_by(Invoice.status)
    )
    if env:
        stmt = stmt.where(Invoice.env == env)
    result = await db.execute(stmt)
    rows = result.all()
    return InvoiceStats(
        counts=[InvoiceStatusCount(status=row.status, count=row.count) for row in rows]
    )


# ---------------------------------------------------------------------------
# POST /invoices — create, sign, and optionally submit
# ---------------------------------------------------------------------------

@router.post("", response_model=InvoiceRead, status_code=status.HTTP_201_CREATED)
async def create_invoice(
    body: InvoiceCreate,
    user: CurrentUserDep,
    db: AsyncSession = Depends(get_db),
) -> Invoice:
    svc = InvoiceService(db)
    try:
        invoice = await svc.create_and_sign(user.tenant_id, body)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Invoice signing failed: {exc}",
        )

    if body.submit:
        try:
            invoice = await svc.submit_to_zatca(
                invoice.id, user.tenant_id,
                use_compliance_csid=body.use_compliance_csid,
            )
        except Exception:
            pass  # status remains "signed"; re-submit via POST /invoices/{id}/submit

    return invoice


# ---------------------------------------------------------------------------
# GET /invoices/{id} — detail
# ---------------------------------------------------------------------------

@router.get("/{id}", response_model=InvoiceRead)
async def get_invoice(
    id: UUID,
    user: CurrentUserDep,
    db: AsyncSession = Depends(get_db),
) -> Invoice:
    invoice = await db.get(Invoice, id)
    if invoice is None or invoice.tenant_id != user.tenant_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="invoice_not_found")
    return invoice


# ---------------------------------------------------------------------------
# POST /invoices/{id}/submit — re-submit a specific invoice to ZATCA
# ---------------------------------------------------------------------------

@router.post("/{id}/submit", response_model=InvoiceRead)
async def submit_invoice(
    id: UUID,
    user: CurrentUserDep,
    db: AsyncSession = Depends(get_db),
) -> Invoice:
    invoice = await db.get(Invoice, id)
    if invoice is None or invoice.tenant_id != user.tenant_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="invoice_not_found")

    svc = InvoiceService(db)
    try:
        invoice = await svc.submit_to_zatca(id, user.tenant_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Submission failed: {exc}",
        )
    return invoice
