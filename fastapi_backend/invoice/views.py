"""Invoice view handlers — thin: authorize, call ONE service method, wrap."""
from uuid import UUID

from fastapi import Depends, Query

from invoice.permissions import ensure_owner_or_admin, is_admin
from invoice.schemas import (
    InvoiceCreate,
    InvoiceListItem,
    InvoiceRead,
    InvoiceStatusUpdate,
)
from invoice.service import InvoiceService
from core.deps import CurrentUser, DbSession
from core.pagination import PageParams, pagination_params, paginate
from core.responses import success


async def create_invoice(payload: InvoiceCreate, db: DbSession, current_user: CurrentUser) -> dict:
    invoice = await InvoiceService(db).create_invoice(current_user.id, payload)
    return success(
        InvoiceRead.model_validate(invoice).model_dump(mode="json"), message="Invoice created."
    )


async def list_invoices(
    db: DbSession,
    current_user: CurrentUser,
    params: PageParams = Depends(pagination_params),
    status: str | None = Query(default=None, description="Filter by status"),
    search: str | None = Query(default=None, description="Search by invoice number"),
    sort: str | None = Query(default=None, description="created_at|total_amount|number, prefix - for desc"),
) -> dict:
    # Non-admins only ever see their own invoices (scoped in SQL, not in Python).
    owner_id = None if is_admin(current_user) else current_user.id
    rows, total = await InvoiceService(db).list_invoices(
        params, owner_id=owner_id, status=status, search=search, sort=sort
    )
    data = [InvoiceListItem.model_validate(r).model_dump(mode="json") for r in rows]
    return paginate(data, total, params)


async def get_invoice(invoice_id: UUID, db: DbSession, current_user: CurrentUser) -> dict:
    invoice = await InvoiceService(db).get_invoice(invoice_id)
    ensure_owner_or_admin(current_user, invoice.owner_id)
    return success(InvoiceRead.model_validate(invoice).model_dump(mode="json"))


async def update_invoice_status(
    invoice_id: UUID,
    payload: InvoiceStatusUpdate,
    db: DbSession,
    current_user: CurrentUser,
) -> dict:
    invoice = await InvoiceService(db).update_status(
        invoice_id,
        payload.status,
        actor_id=current_user.id,
        actor_is_admin=is_admin(current_user),
    )
    return success(
        InvoiceRead.model_validate(invoice).model_dump(mode="json"), message="Status updated."
    )


async def invoice_stats(db: DbSession, current_user: CurrentUser) -> dict:
    owner_id = None if is_admin(current_user) else current_user.id
    stats = await InvoiceService(db).stats(owner_id=owner_id)
    return success(stats.model_dump(mode="json"))
