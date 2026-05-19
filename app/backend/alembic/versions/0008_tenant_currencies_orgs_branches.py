"""tenant currencies / organizations / branches

Splits the single business-profile fields (currency, trade_name, branch_name
on the tenants row) into three first-class tables so a tenant can hold:

* multiple currencies, each with its own daily-update-able exchange rate
  relative to a base currency (rate = 1 for the base);
* multiple organizations (legal entities) with full identity + address;
* multiple branches, each anchored to one organization (FK).

The legacy columns on ``tenants`` (``currency``, ``trade_name``,
``branch_name``) stay in place as the "selected default" pointers for now —
no data migration is necessary.

Revision ID: 0008
Revises: 0007
Create Date: 2026-05-18
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID as PG_UUID

revision: str = "0008"
down_revision: Union[str, None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "tenant_currencies",
        sa.Column("id", PG_UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", PG_UUID(as_uuid=True),
                  sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("code", sa.String(3), nullable=False),
        sa.Column("exchange_rate", sa.Numeric(18, 8), nullable=False, server_default="1"),
        sa.Column("as_of_date", sa.Date, nullable=False, server_default=sa.text("CURRENT_DATE")),
        sa.Column("is_default", sa.Boolean, nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "code", name="uq_tenant_currency_code"),
    )
    op.create_index(
        "ix_tenant_currencies_default",
        "tenant_currencies", ["tenant_id"],
        unique=True, postgresql_where=sa.text("is_default"),
    )

    op.create_table(
        "tenant_organizations",
        sa.Column("id", PG_UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", PG_UUID(as_uuid=True),
                  sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("trade_name", sa.String(200), nullable=True),
        sa.Column("vat_number", sa.String(15), nullable=True),
        sa.Column("registration_number", sa.String(50), nullable=True),
        sa.Column("street", sa.String(200), nullable=True),
        sa.Column("building_number", sa.String(20), nullable=True),
        sa.Column("city_subdivision", sa.String(100), nullable=True),
        sa.Column("city", sa.String(100), nullable=True),
        sa.Column("postal_zone", sa.String(20), nullable=True),
        sa.Column("country_code", sa.String(2), nullable=False, server_default="SA"),
        sa.Column("is_default", sa.Boolean, nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
    )
    op.create_index(
        "ix_tenant_organizations_default",
        "tenant_organizations", ["tenant_id"],
        unique=True, postgresql_where=sa.text("is_default"),
    )

    op.create_table(
        "tenant_branches",
        sa.Column("id", PG_UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", PG_UUID(as_uuid=True),
                  sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("organization_id", PG_UUID(as_uuid=True),
                  sa.ForeignKey("tenant_organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("code", sa.String(50), nullable=True),
        sa.Column("street", sa.String(200), nullable=True),
        sa.Column("building_number", sa.String(20), nullable=True),
        sa.Column("city_subdivision", sa.String(100), nullable=True),
        sa.Column("city", sa.String(100), nullable=True),
        sa.Column("postal_zone", sa.String(20), nullable=True),
        sa.Column("country_code", sa.String(2), nullable=False, server_default="SA"),
        sa.Column("is_default", sa.Boolean, nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
    )
    op.create_index(
        "ix_tenant_branches_org", "tenant_branches", ["tenant_id", "organization_id"],
    )
    op.create_index(
        "ix_tenant_branches_default",
        "tenant_branches", ["tenant_id"],
        unique=True, postgresql_where=sa.text("is_default"),
    )


def downgrade() -> None:
    op.drop_index("ix_tenant_branches_default", table_name="tenant_branches")
    op.drop_index("ix_tenant_branches_org", table_name="tenant_branches")
    op.drop_table("tenant_branches")
    op.drop_index("ix_tenant_organizations_default", table_name="tenant_organizations")
    op.drop_table("tenant_organizations")
    op.drop_index("ix_tenant_currencies_default", table_name="tenant_currencies")
    op.drop_table("tenant_currencies")
