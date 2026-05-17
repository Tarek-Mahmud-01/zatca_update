from uuid import UUID

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPKMixin


class Tenant(UUIDPKMixin, TimestampMixin, Base):
    __tablename__ = "tenants"

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    vat_number: Mapped[str] = mapped_column(String(15), nullable=False, unique=True)
    organization_identifier: Mapped[str] = mapped_column(String(15), nullable=False)

    # Queue / submission strategy. "immediate" enqueues the arq job right after
    # signing. "queued" persists the signed invoice but waits — it gets picked
    # up by /process-queue or a worker tick later. throttle caps the per-minute
    # rate when queued invoices are released.
    queue_strategy: Mapped[str] = mapped_column(
        String(20), nullable=False, default="immediate", server_default="immediate"
    )
    queue_throttle_per_minute: Mapped[int] = mapped_column(
        nullable=False, default=60, server_default="60"
    )

    users: Mapped[list["TenantUser"]] = relationship(back_populates="tenant", lazy="raise")


class TenantUser(UUIDPKMixin, TimestampMixin, Base):
    __tablename__ = "tenant_users"
    __table_args__ = (UniqueConstraint("tenant_id", "email"),)

    tenant_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
    )
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(32), nullable=False, default="admin")

    tenant: Mapped[Tenant] = relationship(back_populates="users", lazy="raise")
