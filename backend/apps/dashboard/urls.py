from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.db.session import get_db
from app.deps import CurrentUserDep
from apps.invoices.models import Invoice

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

@router.get("/stats")
async def get_stats(user: CurrentUserDep, db: AsyncSession = Depends(get_db)):
    # Count invoices by status
    rows = (await db.execute(
        select(Invoice.status, func.count(Invoice.id).label("count"))
        .where(Invoice.tenant_id == user.tenant_id)
        .group_by(Invoice.status)
    )).all()
    by_status = {row.status: row.count for row in rows}
    total = sum(by_status.values())
    return {
        "total": total,
        "by_status": by_status,
        "cleared": by_status.get("cleared", 0),
        "reported": by_status.get("reported", 0),
        "submitted": by_status.get("submitted", 0),
        "failed": by_status.get("failed", 0),
        "queued": by_status.get("queued", 0),
        "signed": by_status.get("signed", 0),
    }
