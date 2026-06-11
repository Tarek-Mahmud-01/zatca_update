from datetime import date
from decimal import Decimal
from uuid import UUID

from sqlalchemy import Boolean, Date, ForeignKey, Numeric, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPKMixin


class TenantCurrency(UUIDPKMixin, TimestampMixin, Base):
    __tablename__ = "tenant_currencies"
    __table_args__ = (UniqueConstraint("tenant_id", "code", name="uq_tenant_currency_code"),)

    tenant_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
    )
    code: Mapped[str] = mapped_column(String(3), nullable=False)
    exchange_rate: Mapped[Decimal] = mapped_column(Numeric(18, 8), nullable=False, default=1)
    as_of_date: Mapped[date] = mapped_column(Date, nullable=False)
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
