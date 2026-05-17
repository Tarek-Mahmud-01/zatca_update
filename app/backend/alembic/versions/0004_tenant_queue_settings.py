"""tenant queue settings

Revision ID: 0004
Revises: 0003
Create Date: 2026-05-17
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "tenants",
        sa.Column(
            "queue_strategy", sa.String(20),
            nullable=False, server_default="immediate",
        ),
    )
    op.add_column(
        "tenants",
        sa.Column(
            "queue_throttle_per_minute", sa.Integer,
            nullable=False, server_default="60",
        ),
    )


def downgrade() -> None:
    op.drop_column("tenants", "queue_throttle_per_minute")
    op.drop_column("tenants", "queue_strategy")
