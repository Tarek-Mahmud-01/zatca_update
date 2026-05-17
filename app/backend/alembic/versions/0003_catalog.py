"""categories, products, customers

Revision ID: 0003
Revises: 0002
Create Date: 2026-05-17
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "categories",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("tenant_id", "name", name="uq_categories_tenant_id_name"),
    )

    op.create_table(
        "products",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("category_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("categories.id", ondelete="SET NULL"), nullable=True),
        sa.Column("sku", sa.String(64), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("unit_price", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("unit_code", sa.String(8), nullable=False, server_default="PCE"),
        sa.Column("tax_category", sa.String(2), nullable=False, server_default="S"),
        sa.Column("tax_percent", sa.Numeric(5, 2), nullable=False, server_default="15"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("tenant_id", "sku", name="uq_products_tenant_id_sku"),
    )

    op.create_table(
        "customers",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("external_id", sa.String(64), nullable=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("vat_number", sa.String(15), nullable=True),
        sa.Column("crn", sa.String(20), nullable=True),
        sa.Column("email", sa.String(255), nullable=True),
        sa.Column("phone", sa.String(32), nullable=True),
        sa.Column("street", sa.String(255), nullable=False, server_default=""),
        sa.Column("building_number", sa.String(16), nullable=False, server_default=""),
        sa.Column("city_subdivision", sa.String(120), nullable=False, server_default=""),
        sa.Column("city", sa.String(120), nullable=False, server_default=""),
        sa.Column("postal_zone", sa.String(16), nullable=False, server_default=""),
        sa.Column("country_code", sa.String(2), nullable=False, server_default="SA"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("tenant_id", "external_id", name="uq_customers_tenant_id_external_id"),
    )


def downgrade() -> None:
    op.drop_table("customers")
    op.drop_table("products")
    op.drop_table("categories")
