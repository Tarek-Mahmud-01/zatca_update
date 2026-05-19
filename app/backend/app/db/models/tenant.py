from datetime import date
from decimal import Decimal
from uuid import UUID

from sqlalchemy import Boolean, Date, ForeignKey, Numeric, String, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPKMixin

DEFAULT_QUEUE_SCHEDULE_TIMES = ["09:00", "12:00", "15:00", "17:00", "19:00"]


class Tenant(UUIDPKMixin, TimestampMixin, Base):
    __tablename__ = "tenants"

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    vat_number: Mapped[str] = mapped_column(String(15), nullable=False, unique=True)
    organization_identifier: Mapped[str] = mapped_column(String(15), nullable=False)

    # Editable business profile. Used on every invoice the tenant generates.
    # `currency` is the ISO-4217 code (defaults to SAR). `trade_name` is the
    # supplier name shown on the invoice when set — falls back to `name`.
    # `branch_name` is metadata for multi-branch tenants.
    currency: Mapped[str] = mapped_column(
        String(3), nullable=False, default="SAR", server_default="SAR",
    )
    trade_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    branch_name: Mapped[str | None] = mapped_column(String(200), nullable=True)

    # Queue / submission strategy. "immediate" enqueues the arq job right after
    # signing. "queued" persists the signed invoice but waits — it gets picked
    # up by /process-queue or a scheduled worker tick later.
    queue_strategy: Mapped[str] = mapped_column(
        String(20), nullable=False, default="immediate", server_default="immediate"
    )
    # Legacy. Still on the table for backward compatibility; the new scheduled
    # model releases the *whole* queue per tick, no per-minute cap.
    queue_throttle_per_minute: Mapped[int] = mapped_column(
        nullable=False, default=60, server_default="60"
    )
    # Picks how the worker decides when to fire a release:
    #   "times"    — match the current HH:MM against ``queue_schedule_times``.
    #   "interval" — fire every ``queue_schedule_interval_minutes`` (anchored at
    #                midnight UTC, so "every 60" = HH:00 each hour).
    queue_schedule_mode: Mapped[str] = mapped_column(
        String(20), nullable=False, default="times", server_default="times",
    )
    # Used when mode = "times". List of HH:MM strings (24h, UTC).
    queue_schedule_times: Mapped[list[str]] = mapped_column(
        JSONB,
        nullable=False,
        default=lambda: list(DEFAULT_QUEUE_SCHEDULE_TIMES),
        server_default=text("'[\"09:00\", \"12:00\", \"15:00\", \"17:00\", \"19:00\"]'::jsonb"),
    )
    # Used when mode = "interval". Minutes between releases. Capped at 24h.
    queue_schedule_interval_minutes: Mapped[int] = mapped_column(
        nullable=False, default=60, server_default="60",
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
    # Per-user default branch — picked up as the pre-selected branch on the
    # new-invoice page. Nullable: falls back to the tenant's default branch.
    default_branch_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("tenant_branches.id", ondelete="SET NULL"),
        nullable=True,
    )

    tenant: Mapped[Tenant] = relationship(back_populates="users", lazy="raise")


# ---------------------------------------------------------------------------
# Multi-currency / multi-organization / multi-branch tables.
#
# These replace the single-string fields (``Tenant.currency``,
# ``Tenant.trade_name``, ``Tenant.branch_name``) — the latter are kept for
# backward compatibility but the new tables are the source of truth for
# everything that an invoice can pick from.
# ---------------------------------------------------------------------------


class TenantCurrency(UUIDPKMixin, TimestampMixin, Base):
    __tablename__ = "tenant_currencies"
    __table_args__ = (UniqueConstraint("tenant_id", "code", name="uq_tenant_currency_code"),)

    tenant_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False,
    )
    code: Mapped[str] = mapped_column(String(3), nullable=False)
    # Rate expressed as "1 unit of `code` = X units of the default currency".
    # For the default currency itself the rate is always 1.
    exchange_rate: Mapped[Decimal] = mapped_column(Numeric(18, 8), nullable=False, default=1)
    as_of_date: Mapped[date] = mapped_column(Date, nullable=False)
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class TenantOrganization(UUIDPKMixin, TimestampMixin, Base):
    __tablename__ = "tenant_organizations"

    tenant_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False,
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    trade_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    vat_number: Mapped[str | None] = mapped_column(String(15), nullable=True)
    registration_number: Mapped[str | None] = mapped_column(String(50), nullable=True)
    street: Mapped[str | None] = mapped_column(String(200), nullable=True)
    building_number: Mapped[str | None] = mapped_column(String(20), nullable=True)
    city_subdivision: Mapped[str | None] = mapped_column(String(100), nullable=True)
    city: Mapped[str | None] = mapped_column(String(100), nullable=True)
    postal_zone: Mapped[str | None] = mapped_column(String(20), nullable=True)
    country_code: Mapped[str] = mapped_column(String(2), nullable=False, default="SA")
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class TenantBranch(UUIDPKMixin, TimestampMixin, Base):
    __tablename__ = "tenant_branches"

    tenant_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False,
    )
    organization_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("tenant_organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    code: Mapped[str | None] = mapped_column(String(50), nullable=True)
    street: Mapped[str | None] = mapped_column(String(200), nullable=True)
    building_number: Mapped[str | None] = mapped_column(String(20), nullable=True)
    city_subdivision: Mapped[str | None] = mapped_column(String(100), nullable=True)
    city: Mapped[str | None] = mapped_column(String(100), nullable=True)
    postal_zone: Mapped[str | None] = mapped_column(String(20), nullable=True)
    country_code: Mapped[str] = mapped_column(String(2), nullable=False, default="SA")
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
