"""Invoice repository. Encapsulates the eager-loading strategy so no caller can
accidentally trigger N+1 (the models use lazy="raise").
"""
from collections.abc import Sequence
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import joinedload, selectinload
from sqlalchemy.sql.base import ExecutableOption

from invoice.models import Invoice, InvoiceItem
from core.repository import BaseRepository


class InvoiceRepository(BaseRepository[Invoice]):
    model = Invoice

    # owner only — a single LEFT JOIN. Used by list endpoints (no items needed).
    @staticmethod
    def _list_options() -> tuple[ExecutableOption, ...]:
        return (joinedload(Invoice.owner),)

    # owner (JOIN) + items (one extra SELECT … IN, NOT a per-row query).
    @staticmethod
    def _detail_options() -> tuple[ExecutableOption, ...]:
        return (joinedload(Invoice.owner), selectinload(Invoice.items))

    async def list_invoices(
        self,
        *whereclause: Any,
        order_by: Sequence[Any],
        limit: int,
        offset: int,
    ) -> Sequence[Invoice]:
        return await self.list(
            *whereclause,
            order_by=order_by,
            options=self._list_options(),
            limit=limit,
            offset=offset,
        )

    async def get_detail(self, invoice_id: Any) -> Invoice:
        return await self.get_or_404(invoice_id, options=self._detail_options())

    async def add_items(self, rows: Sequence[dict[str, Any]]) -> list[InvoiceItem]:
        """Bulk insert all line items in ONE round-trip."""
        objs = [InvoiceItem(**row) for row in rows]
        self.db.add_all(objs)
        await self.db.flush()
        return objs

    async def status_breakdown(self, *whereclause: Any) -> list[tuple[str, int, Decimal]]:
        """Counts + totals per status in a SINGLE GROUP BY — never a loop."""
        stmt = (
            select(
                Invoice.status,
                func.count(Invoice.id),
                func.coalesce(func.sum(Invoice.total_amount), 0),
            )
            .group_by(Invoice.status)
        )
        if whereclause:
            stmt = stmt.where(*whereclause)
        rows = (await self.db.execute(stmt)).all()
        return [(str(r[0]), int(r[1]), Decimal(r[2])) for r in rows]
