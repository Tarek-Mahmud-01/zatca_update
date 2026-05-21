"""tenant_users.page_size + daily_quota fields

Moves display + soft-quota preferences out of browser localStorage and into
the database so they're authoritative, multi-device consistent, and not
overwritten by stale frontend caches.

Scoped to the user (not the tenant) because the architecture spec is
explicit: "Changes by one user must not overwrite another user's
preferences." Tenant-wide knobs (queue scheduling) already live on
`tenants`; these are per-user UI preferences.

Revision ID: 0011
Revises: 0010
Create Date: 2026-05-20
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0011"
down_revision: Union[str, None] = "0010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "tenant_users",
        sa.Column("page_size", sa.Integer(), nullable=False, server_default="25"),
    )
    op.add_column(
        "tenant_users",
        sa.Column("reported_daily_quota", sa.Integer(), nullable=False, server_default="500"),
    )
    op.add_column(
        "tenant_users",
        sa.Column("clearance_daily_quota", sa.Integer(), nullable=False, server_default="100"),
    )


def downgrade() -> None:
    op.drop_column("tenant_users", "clearance_daily_quota")
    op.drop_column("tenant_users", "reported_daily_quota")
    op.drop_column("tenant_users", "page_size")
