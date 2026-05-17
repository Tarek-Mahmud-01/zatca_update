"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-05-16

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "tenants",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("vat_number", sa.String(15), nullable=False, unique=True),
        sa.Column("organization_identifier", sa.String(15), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "tenant_users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("hashed_password", sa.String(255), nullable=False),
        sa.Column("role", sa.String(32), nullable=False, server_default="admin"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("tenant_id", "email", name="uq_tenant_users_tenant_id_email"),
    )

    op.create_table(
        "csr_configs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("env", sa.String(20), nullable=False),
        sa.Column("common_name", sa.String(200), nullable=False),
        sa.Column("serial_number", sa.String(200), nullable=False),
        sa.Column("organization_identifier", sa.String(15), nullable=False),
        sa.Column("organization_unit_name", sa.String(200), nullable=False),
        sa.Column("organization_name", sa.String(200), nullable=False),
        sa.Column("country_name", sa.String(2), nullable=False, server_default="SA"),
        sa.Column("invoice_type", sa.String(4), nullable=False, server_default="1100"),
        sa.Column("location_address", sa.String(255), nullable=False),
        sa.Column("industry_business_category", sa.String(200), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "csids",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("env", sa.String(20), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("private_key_pem", sa.Text, nullable=False),
        sa.Column("csr_pem", sa.Text, nullable=False),
        sa.Column("certificate_pem", sa.Text, nullable=True),
        sa.Column("binary_security_token", sa.Text, nullable=True),
        sa.Column("secret", sa.Text, nullable=True),
        sa.Column("request_id", sa.String(64), nullable=True),
        sa.Column("disposition_message", sa.Text, nullable=True),
        sa.Column("issued_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_csids_tenant_env_kind", "csids", ["tenant_id", "env", "kind"])

    op.create_table(
        "invoices",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("env", sa.String(20), nullable=False),
        sa.Column("uuid", postgresql.UUID(as_uuid=True), nullable=False, unique=True),
        sa.Column("icv", sa.BigInteger, nullable=False),
        sa.Column("doc_type", sa.String(40), nullable=False),
        sa.Column("subtype", sa.String(10), nullable=False),
        sa.Column("payload_json", postgresql.JSONB, nullable=False),
        sa.Column("ubl_xml", sa.Text, nullable=True),
        sa.Column("signed_xml", sa.Text, nullable=True),
        sa.Column("cleared_xml", sa.Text, nullable=True),
        sa.Column("invoice_hash", sa.String(128), nullable=True),
        sa.Column("qr_base64", sa.Text, nullable=True),
        sa.Column("status", sa.String(40), nullable=False, server_default="queued"),
        sa.Column("last_error", sa.Text, nullable=True),
        sa.Column("signed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("tenant_id", "env", "icv", name="uq_invoices_tenant_env_icv"),
    )
    op.create_index(
        "ix_invoices_tenant_status_created", "invoices",
        ["tenant_id", "status", "created_at"]
    )

    op.create_table(
        "pih_chain",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("env", sa.String(20), nullable=False),
        sa.Column("icv", sa.BigInteger, nullable=False),
        sa.Column("invoice_hash", sa.String(128), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("tenant_id", "env", "icv", name="uq_pih_chain_tenant_env_icv"),
    )

    op.create_table(
        "submissions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("invoice_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("invoices.id", ondelete="CASCADE"), nullable=False),
        sa.Column("env", sa.String(20), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("request_payload", postgresql.JSONB, nullable=False),
        sa.Column("response_payload", postgresql.JSONB, nullable=True),
        sa.Column("http_status", sa.Integer, nullable=True),
        sa.Column("zatca_status", sa.String(40), nullable=True),
        sa.Column("attempt", sa.Integer, nullable=False, server_default="1"),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "webhooks",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("url", sa.String(500), nullable=False),
        sa.Column("secret", sa.String(128), nullable=False),
        sa.Column("events", postgresql.JSONB, nullable=False, server_default="[]"),
        sa.Column("enabled", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("webhooks")
    op.drop_table("submissions")
    op.drop_table("pih_chain")
    op.drop_index("ix_invoices_tenant_status_created", table_name="invoices")
    op.drop_table("invoices")
    op.drop_index("ix_csids_tenant_env_kind", table_name="csids")
    op.drop_table("csids")
    op.drop_table("csr_configs")
    op.drop_table("tenant_users")
    op.drop_table("tenants")
