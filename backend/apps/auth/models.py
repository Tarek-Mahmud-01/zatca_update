from uuid import UUID

from sqlalchemy import Boolean, ForeignKey, Integer, String, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPKMixin

DEFAULT_QUEUE_SCHEDULE_TIMES = ["09:00", "12:00", "15:00", "17:00", "19:00"]


class Tenant(UUIDPKMixin, TimestampMixin, Base):
    __tablename__ = "tenants"

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    vat_number: Mapped[str] = mapped_column(String(15), nullable=False, unique=True)
    organization_identifier: Mapped[str] = mapped_column(String(15), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="SAR", server_default="SAR")
    trade_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    branch_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    queue_strategy: Mapped[str] = mapped_column(String(20), nullable=False, default="immediate", server_default="immediate")
    queue_throttle_per_minute: Mapped[int] = mapped_column(nullable=False, default=60, server_default="60")
    queue_schedule_mode: Mapped[str] = mapped_column(String(20), nullable=False, default="times", server_default="times")
    queue_schedule_times: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False,
        default=lambda: list(DEFAULT_QUEUE_SCHEDULE_TIMES),
        server_default=text("'[\"09:00\", \"12:00\", \"15:00\", \"17:00\", \"19:00\"]'::jsonb"),
    )
    queue_schedule_interval_minutes: Mapped[int] = mapped_column(nullable=False, default=60, server_default="60")


class TenantUser(UUIDPKMixin, TimestampMixin, Base):
    __tablename__ = "tenant_users"
    __table_args__ = (UniqueConstraint("tenant_id", "email"),)

    tenant_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
    )
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(32), nullable=False, default="admin")
    default_branch_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("tenant_branches.id", ondelete="SET NULL"), nullable=True
    )
    page_size: Mapped[int] = mapped_column(Integer, nullable=False, default=25, server_default="25")
    reported_daily_quota: Mapped[int] = mapped_column(Integer, nullable=False, default=500, server_default="500")
    clearance_daily_quota: Mapped[int] = mapped_column(Integer, nullable=False, default=100, server_default="100")
