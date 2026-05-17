"""tenant queue schedule mode + interval

Adds a ``queue_schedule_mode`` column so a tenant can pick between
explicit times-of-day and a fixed minute/hour interval. The interval is
stored as minutes for simplicity (an "every 2 hours" preset just writes
120). Both columns get sensible defaults that preserve the prior behaviour
for existing tenants.

Revision ID: 0006
Revises: 0005
Create Date: 2026-05-17
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "tenants",
        sa.Column(
            "queue_schedule_mode",
            sa.String(20),
            nullable=False,
            server_default="times",  # "times" or "interval"
        ),
    )
    op.add_column(
        "tenants",
        sa.Column(
            "queue_schedule_interval_minutes",
            sa.Integer,
            nullable=False,
            server_default="60",     # every hour by default if mode switched to interval
        ),
    )


def downgrade() -> None:
    op.drop_column("tenants", "queue_schedule_interval_minutes")
    op.drop_column("tenants", "queue_schedule_mode")
