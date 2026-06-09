"""Invoice business logic. Demonstrates the ORM rules end to end:

- totals computed once in Python from the request payload (no per-item query)
- line items inserted with ONE bulk INSERT
- list uses joinedload(owner); detail adds selectinload(items) — zero N+1
- stats is a single GROUP BY aggregation
- filtering / search / ordering / pagination all push down to SQL
"""
from collections.abc import Sequence
from decimal import Decimal
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from invoice.constants import InvoiceStatus
from invoice.exceptions import InvoiceNumberExists
from invoice.models import Invoice
from invoice.repository import InvoiceRepository
from invoice.schemas import InvoiceCreate, InvoiceStats, StatusBucket
from invoice.validators import normalize_sort, validate_currency
from core.exceptions import PermissionDeniedError
from core.pagination import PageParams
from core.service import BaseService

_TWOPLACES = Decimal("0.01")

_SORT_COLUMNS = {
    "created_at": Invoice.created_at,
    "total_amount": Invoice.total_amount,
    "number": Invoice.number,
}


class InvoiceService(BaseService):
    def __init__(self, db: AsyncSession) -> None:
        super().__init__(db)
        self.invoices = InvoiceRepository(db)

    async def create_invoice(self, owner_id: UUID, payload: InvoiceCreate) -> Invoice:
        currency = validate_currency(payload.currency)
        if await self.invoices.exists(
            Invoice.owner_id == owner_id, Invoice.number == payload.number
        ):
            raise InvoiceNumberExists()

        # Compute line totals + grand total once, in memory.
        item_rows: list[dict] = []
        total = Decimal("0")
        for it in payload.items:
            line_total = (it.quantity * it.unit_price).quantize(_TWOPLACES)
            total += line_total
            item_rows.append(
                {
                    "description": it.description,
                    "quantity": it.quantity,
                    "unit_price": it.unit_price,
                    "line_total": line_total,
                }
            )

        invoice = await self.invoices.create(
            number=payload.number,
            owner_id=owner_id,
            currency=currency,
            notes=payload.notes,
            status=InvoiceStatus.DRAFT.value,
            total_amount=total.quantize(_TWOPLACES),
        )
        for row in item_rows:
            row["invoice_id"] = invoice.id
        await self.invoices.add_items(item_rows)  # bulk insert
        await self.commit()
        # Re-fetch fully eager-loaded for the response (owner + items).
        return await self.invoices.get_detail(invoice.id)

    async def list_invoices(
        self,
        params: PageParams,
        *,
        owner_id: UUID | None = None,
        status: str | None = None,
        search: str | None = None,
        sort: str | None = None,
    ) -> tuple[Sequence[Invoice], int]:
        where: list = []
        if owner_id is not None:
            where.append(Invoice.owner_id == owner_id)
        if status:
            where.append(Invoice.status == status)
        if search:
            where.append(Invoice.number.ilike(f"%{search.strip()}%"))

        sort = normalize_sort(sort)
        column = _SORT_COLUMNS[sort.lstrip("-")]
        order_by = [column.desc() if sort.startswith("-") else column.asc()]

        rows = await self.invoices.list_invoices(
            *where, order_by=order_by, limit=params.limit, offset=params.offset
        )
        total = await self.invoices.count(*where)
        return rows, total

    async def get_invoice(self, invoice_id: UUID) -> Invoice:
        return await self.invoices.get_detail(invoice_id)

    async def update_status(
        self,
        invoice_id: UUID,
        status: InvoiceStatus,
        *,
        actor_id: UUID,
        actor_is_admin: bool,
    ) -> Invoice:
        invoice = await self.invoices.get_or_404(invoice_id)
        if not actor_is_admin and invoice.owner_id != actor_id:
            raise PermissionDeniedError("You can only modify your own invoices.")
        await self.invoices.update(invoice, status=status.value)
        await self.commit()
        return await self.invoices.get_detail(invoice_id)

    async def stats(self, *, owner_id: UUID | None = None) -> InvoiceStats:
        where = [Invoice.owner_id == owner_id] if owner_id is not None else []
        breakdown = await self.invoices.status_breakdown(*where)
        buckets = [StatusBucket(status=s, count=c, total=t) for s, c, t in breakdown]
        return InvoiceStats(
            by_status=buckets,
            total_count=sum(b.count for b in buckets),
            grand_total=sum((b.total for b in buckets), Decimal("0")),
        )
