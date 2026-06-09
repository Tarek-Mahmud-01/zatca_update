"""Finance models: Currency (1) → ExchangeRate (many).

`lazy="raise"` forces the repository to eager-load — exchange-rate lists join
the currency in one query (no N+1).
"""
import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import Boolean, Date, ForeignKey, Numeric, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base
from core.mixins import TimestampMixin, UUIDMixin


class Currency(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "currencies"

    code: Mapped[str] = mapped_column(String(3), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    rates = relationship(
        "ExchangeRate", back_populates="currency", cascade="all, delete-orphan", lazy="raise"
    )


class ExchangeRate(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "exchange_rates"

    currency_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("currencies.id", ondelete="CASCADE"), nullable=False, index=True
    )
    rate: Mapped[Decimal] = mapped_column(Numeric(18, 6), nullable=False)
    as_of_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)

    currency = relationship("Currency", back_populates="rates", lazy="raise")

    __table_args__ = (
        UniqueConstraint("currency_id", "as_of_date", name="uq_rate_currency_date"),
    )
