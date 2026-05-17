from decimal import Decimal
from uuid import UUID

from sqlalchemy import ForeignKey, Numeric, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPKMixin


class Category(UUIDPKMixin, TimestampMixin, Base):
    __tablename__ = "categories"
    __table_args__ = (UniqueConstraint("tenant_id", "name"),)

    tenant_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)


class Product(UUIDPKMixin, TimestampMixin, Base):
    __tablename__ = "products"
    __table_args__ = (UniqueConstraint("tenant_id", "sku"),)

    tenant_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
    )
    category_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("categories.id", ondelete="SET NULL"),
        nullable=True,
    )
    sku: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    unit_code: Mapped[str] = mapped_column(String(8), nullable=False, default="PCE")
    tax_category: Mapped[str] = mapped_column(String(2), nullable=False, default="S")
    tax_percent: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False, default=15)


class Customer(UUIDPKMixin, TimestampMixin, Base):
    __tablename__ = "customers"
    __table_args__ = (UniqueConstraint("tenant_id", "external_id"),)

    tenant_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
    )
    external_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    vat_number: Mapped[str | None] = mapped_column(String(15), nullable=True)
    crn: Mapped[str | None] = mapped_column(String(20), nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    street: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    building_number: Mapped[str] = mapped_column(String(16), nullable=False, default="")
    city_subdivision: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    city: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    postal_zone: Mapped[str] = mapped_column(String(16), nullable=False, default="")
    country_code: Mapped[str] = mapped_column(String(2), nullable=False, default="SA")
