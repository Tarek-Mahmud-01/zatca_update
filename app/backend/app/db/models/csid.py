from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPKMixin


class CsrConfig(UUIDPKMixin, TimestampMixin, Base):
    """One row per tenant per env — the inputs to CSR generation."""

    __tablename__ = "csr_configs"

    tenant_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
    )
    env: Mapped[str] = mapped_column(String(20), nullable=False)
    common_name: Mapped[str] = mapped_column(String(200), nullable=False)
    serial_number: Mapped[str] = mapped_column(String(200), nullable=False)
    organization_identifier: Mapped[str] = mapped_column(String(15), nullable=False)
    organization_unit_name: Mapped[str] = mapped_column(String(200), nullable=False)
    organization_name: Mapped[str] = mapped_column(String(200), nullable=False)
    country_name: Mapped[str] = mapped_column(String(2), nullable=False, default="SA")
    invoice_type: Mapped[str] = mapped_column(String(4), nullable=False, default="1100")
    location_address: Mapped[str] = mapped_column(String(255), nullable=False)
    industry_business_category: Mapped[str] = mapped_column(String(200), nullable=False)


class Csid(UUIDPKMixin, TimestampMixin, Base):
    """Compliance or production CSID bundle for a tenant in a specific env."""

    __tablename__ = "csids"

    tenant_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
    )
    env: Mapped[str] = mapped_column(String(20), nullable=False)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)

    private_key_pem: Mapped[str] = mapped_column(Text, nullable=False)
    csr_pem: Mapped[str] = mapped_column(Text, nullable=False)
    certificate_pem: Mapped[str | None] = mapped_column(Text, nullable=True)

    binary_security_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    secret: Mapped[str | None] = mapped_column(Text, nullable=True)
    request_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    disposition_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    issued_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    compliance_passed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
