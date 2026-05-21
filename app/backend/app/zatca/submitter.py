"""Shared ZATCA submission logic — one function, two call sites:

  * The arq worker (``submit_invoice_job``) calls it when Redis + the worker
    are running. This is the production / multi-server path.
  * The inline fallback (``_advance_inline`` in api/v1/invoices.py) calls it
    when Redis isn't reachable, so queued invoices still get submitted to
    ZATCA — they're no longer just marked "reported" optimistically.

Both paths produce identical side-effects: a ``submissions`` row, an updated
``invoices.status``, and an event published to subscribed clients. Workers
re-fetch the latest production CSID + tenant config on every call, so config
changes (e.g. CSID renewal, queue strategy change) take effect immediately
without needing a worker restart.
"""
from __future__ import annotations

import base64
from datetime import datetime, timezone
from typing import Literal

from sqlalchemy import desc, select

from app.config import ZatcaEnv
from app.db.models import Csid, Invoice, Submission
from app.events import publish
from app.zatca.client import ZatcaClient

REPORTING_FAMILY: set[str] = {
    "simplified_invoice",
    "simplified_credit_note",
    "simplified_debit_note",
    "nominal_supply_invoice",
    "advance_payment_invoice",
}


SubmitOutcome = Literal[
    "ok",            # 2xx — invoice is now cleared / reported
    "rejected",      # 4xx — ZATCA returned a permanent validation error
    "retrying",      # 5xx — transient, will be retried by the caller
    "no_csid",       # no production CSID available
    "local_only",    # CSID is a dev cert; never sent to ZATCA
    "skip",          # invoice not in a submittable state
]


async def submit_invoice_to_zatca(
    db,
    inv: Invoice,
    *,
    attempt: int = 1,
    max_attempts: int = 5,
) -> SubmitOutcome:
    """Run the full submit-to-ZATCA flow for one invoice.

    The caller owns the DB session and must commit. We refresh ``inv`` and
    re-fetch the CSID inside this function so concurrent config changes
    (renewal, revocation) are picked up immediately — no stale cache.
    """
    if inv.status not in {"queued", "retrying"}:
        return "skip"

    # In sandbox, ZATCA returns a canned dummy cert from /production/csids
    # whose private key we don't have. Use the compliance CSID (whose cert
    # was actually issued for our key) and submit to /compliance/invoices.
    # In simulation/production, use the real production CSID + live endpoints.
    target_kind = "compliance" if inv.env == "sandbox" else "production"
    csid = await db.scalar(
        select(Csid)
        .where(
            Csid.tenant_id == inv.tenant_id,
            Csid.env == inv.env,
            Csid.kind == target_kind,
            Csid.revoked_at.is_(None),
        )
        .order_by(desc(Csid.issued_at))
    )
    if csid is None:
        inv.status = "failed_no_csid"
        inv.last_error = f"no {target_kind} CSID available"
        await _emit(inv, "invoice.failed", inv.last_error)
        return "no_csid"

    if csid.is_dev:
        inv.status = "local_only"
        inv.last_error = (
            "Signed locally with a development certificate. Complete ZATCA "
            "onboarding (CSR → CCSID → PCSID) to submit real invoices."
        )
        inv.submitted_at = datetime.now(timezone.utc)
        await _emit(inv, "invoice.local_only", inv.last_error)
        return "local_only"

    client = ZatcaClient(ZatcaEnv(inv.env))
    invoice_b64 = base64.b64encode(inv.signed_xml.encode()).decode()
    kind = "reporting" if inv.doc_type in REPORTING_FAMILY else "clearance"

    if inv.env == "sandbox":
        # Sandbox always uses the compliance endpoint regardless of doc type.
        resp = await client.submit_compliance_invoice(
            binary_security_token=csid.binary_security_token or "",
            secret=csid.secret or "",
            invoice_b64=invoice_b64,
            invoice_hash=inv.invoice_hash or "",
            uuid=str(inv.uuid),
        )
    else:
        submit_fn = client.submit_reporting if kind == "reporting" else client.submit_clearance
        resp = await submit_fn(
            binary_security_token=csid.binary_security_token or "",
            secret=csid.secret or "",
            invoice_b64=invoice_b64,
            invoice_hash=inv.invoice_hash or "",
            uuid=str(inv.uuid),
        )

    db.add(Submission(
        invoice_id=inv.id,
        env=inv.env,
        kind=kind,
        request_payload={"invoice_hash": inv.invoice_hash, "uuid": str(inv.uuid)},
        response_payload=resp.body,
        http_status=resp.status_code,
        zatca_status=str(
            resp.body.get("status")
            or resp.body.get("reportingStatus")
            or resp.body.get("clearanceStatus")
            or ""
        ),
        attempt=attempt,
        submitted_at=datetime.now(timezone.utc),
    ))

    if 200 <= resp.status_code < 300:
        inv.status = "cleared" if kind == "clearance" else "reported"
        if kind == "clearance":
            cleared = resp.body.get("clearedInvoice")
            if cleared:
                inv.cleared_xml = base64.b64decode(cleared).decode("utf-8", errors="replace")
        inv.submitted_at = datetime.now(timezone.utc)
        await _emit(inv, f"invoice.{inv.status}")
        return "ok"

    if 400 <= resp.status_code < 500:
        inv.status = "rejected"
        inv.last_error = resp.raw_text[:2000]
        await _emit(inv, "invoice.rejected", inv.last_error)
        return "rejected"

    # 5xx
    if attempt >= max_attempts:
        inv.status = "failed_pending_review"
    else:
        inv.status = "retrying"
    inv.last_error = resp.raw_text[:2000]
    await _emit(
        inv,
        "invoice.retrying" if inv.status == "retrying" else "invoice.failed",
        inv.last_error,
    )
    return "retrying"


async def _emit(inv: Invoice, event_type: str, error: str | None = None) -> None:
    payload: dict = {
        "invoice_id": str(inv.id),
        "icv": inv.icv,
        "doc_type": inv.doc_type,
        "status": inv.status,
    }
    if error is not None:
        payload["error"] = error[:500]
    await publish(inv.tenant_id, event_type, **payload)
