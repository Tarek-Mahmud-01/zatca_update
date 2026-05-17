from datetime import datetime
from uuid import UUID

from sqlalchemy import BigInteger, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPKMixin


class Invoice(UUIDPKMixin, TimestampMixin, Base):
    __tablename__ = "invoices"
    __table_args__ = (
        UniqueConstraint("tenant_id", "env", "icv"),
        Index("ix_invoices_tenant_status_created", "tenant_id", "status", "created_at"),
    )

    tenant_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
    )
    env: Mapped[str] = mapped_column(String(20), nullable=False)
    uuid: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False, unique=True)
    icv: Mapped[int] = mapped_column(BigInteger, nullable=False)

    doc_type: Mapped[str] = mapped_column(String(40), nullable=False)
    subtype: Mapped[str] = mapped_column(String(10), nullable=False)

    payload_json: Mapped[dict] = mapped_column(JSONB, nullable=False)
    ubl_xml: Mapped[str | None] = mapped_column(Text, nullable=True)
    signed_xml: Mapped[str | None] = mapped_column(Text, nullable=True)
    cleared_xml: Mapped[str | None] = mapped_column(Text, nullable=True)
    invoice_hash: Mapped[str | None] = mapped_column(String(128), nullable=True)
    qr_base64: Mapped[str | None] = mapped_column(Text, nullable=True)

    status: Mapped[str] = mapped_column(String(40), nullable=False, default="queued")
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    signed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class PihChain(UUIDPKMixin, TimestampMixin, Base):
    __tablename__ = "pih_chain"
    __table_args__ = (UniqueConstraint("tenant_id", "env", "icv"),)

    tenant_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
    )
    env: Mapped[str] = mapped_column(String(20), nullable=False)
    icv: Mapped[int] = mapped_column(BigInteger, nullable=False)
    invoice_hash: Mapped[str] = mapped_column(String(128), nullable=False)


class Submission(UUIDPKMixin, TimestampMixin, Base):
    __tablename__ = "submissions"

    invoice_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("invoices.id", ondelete="CASCADE"), nullable=False
    )
    env: Mapped[str] = mapped_column(String(20), nullable=False)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    request_payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    response_payload: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    http_status: Mapped[int | None] = mapped_column(Integer, nullable=True)
    zatca_status: Mapped[str | None] = mapped_column(String(40), nullable=True)
    attempt: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
