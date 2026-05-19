"""csids.is_dev — mark dev/self-signed CSIDs

Demo seeding generates a self-signed certificate when no real CSID exists.
Invoices signed with such a cert can never pass ZATCA validation (wrong
X509IssuerName, wrong signatureValue, etc.) because the cert is not in
ZATCA's chain of trust. We flag those CSIDs so the worker can refuse to
submit their invoices to real ZATCA endpoints, avoiding noisy rejections
and giving the user a clear "complete onboarding" message instead.

Revision ID: 0010
Revises: 0009
Create Date: 2026-05-19
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0010"
down_revision: Union[str, None] = "0009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "csids",
        sa.Column("is_dev", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    # Existing rows with placeholder DEMO secrets are dev — back-fill them.
    op.execute(
        "UPDATE csids SET is_dev = TRUE "
        "WHERE binary_security_token = 'DEMO-BST' OR secret = 'DEMO-SECRET'"
    )


def downgrade() -> None:
    op.drop_column("csids", "is_dev")
