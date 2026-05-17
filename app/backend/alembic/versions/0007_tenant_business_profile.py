"""tenant business profile (currency / trade name / branch)

Adds three editable business-identity fields per tenant so invoices can
populate currency, supplier display name, and branch metadata without
hard-coding values in the frontend.

Revision ID: 0007
Revises: 0006
Create Date: 2026-05-17
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: Union[str, None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "tenants",
        sa.Column(
            "currency",
            sa.String(3),
            nullable=False,
            server_default="SAR",
        ),
    )
    op.add_column(
        "tenants",
        sa.Column("trade_name", sa.String(200), nullable=True),
    )
    op.add_column(
        "tenants",
        sa.Column("branch_name", sa.String(200), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("tenants", "branch_name")
    op.drop_column("tenants", "trade_name")
    op.drop_column("tenants", "currency")
