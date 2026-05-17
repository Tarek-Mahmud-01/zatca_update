"""tenant queue daily schedule

Switches the queue model from a per-minute throttle to a list of fixed
HH:MM release times. Each scheduled tick releases *all* queued invoices in
one batch — no per-tick cap. The old throttle column stays on the table for
backward compatibility but is no longer read by the new code path.

Revision ID: 0005
Revises: 0004
Create Date: 2026-05-17
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_DEFAULT_TIMES_SQL = "'[\"09:00\", \"12:00\", \"15:00\", \"17:00\", \"19:00\"]'::jsonb"


def upgrade() -> None:
    op.add_column(
        "tenants",
        sa.Column(
            "queue_schedule_times",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text(_DEFAULT_TIMES_SQL),
        ),
    )


def downgrade() -> None:
    op.drop_column("tenants", "queue_schedule_times")
