"""Invoice + InvoiceItem ORM models.

`lazy="raise"` on the relationships is deliberate: SQLAlchemy will RAISE if code
touches `invoice.owner` / `invoice.items` without the repository having
eager-loaded them. That turns accidental N+1 (and serializer-triggered queries)
into a loud error at dev time instead of a silent perf cliff in prod.
"""
import uuid
from decimal import Decimal

from sqlalchemy import ForeignKey, Index, Numeric, String
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from invoice.constants import InvoiceStatus
from core.database import Base
from core.mixins import TimestampMixin, UUIDMixin


class Invoice(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "invoices"

    number: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    owner_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default=InvoiceStatus.DRAFT.value, index=True
    )
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="SAR")
    # Denormalized total so list endpoints never re-aggregate line items per row.
    total_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False, default=Decimal("0"))
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)

    owner = relationship("User", lazy="raise")
    items = relationship(
        "InvoiceItem", back_populates="invoice", cascade="all, delete-orphan", lazy="raise"
    )

    __table_args__ = (
        Index("uq_invoice_owner_number", "owner_id", "number", unique=True),
    )


class InvoiceItem(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "invoice_items"

    invoice_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("invoices.id", ondelete="CASCADE"), nullable=False, index=True
    )
    description: Mapped[str] = mapped_column(String(255), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(18, 3), nullable=False, default=Decimal("1"))
    unit_price: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False, default=Decimal("0"))
    line_total: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False, default=Decimal("0"))

    invoice = relationship("Invoice", back_populates="items", lazy="raise")
