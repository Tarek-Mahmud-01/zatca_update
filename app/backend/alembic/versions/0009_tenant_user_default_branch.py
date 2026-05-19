"""tenant_users.default_branch_id

Allows a per-user default branch. When set, new invoices created by this
user pre-select their branch instead of the tenant-wide default.

Revision ID: 0009
Revises: 0008
Create Date: 2026-05-18
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID as PG_UUID

revision: str = "0009"
down_revision: Union[str, None] = "0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "tenant_users",
        sa.Column(
            "default_branch_id",
            PG_UUID(as_uuid=True),
            sa.ForeignKey("tenant_branches.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("tenant_users", "default_branch_id")
