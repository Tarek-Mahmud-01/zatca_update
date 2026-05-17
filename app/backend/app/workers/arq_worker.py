"""arq worker — submits queued invoices to ZATCA reporting/clearance endpoints.

Run with:
    arq app.workers.arq_worker.WorkerSettings

PIH-chain note: the chain is already advanced at sign time inside the API
(see api/v1/invoices.py). The worker never touches pih_chain — it only updates
``invoices.status`` and records the ZATCA round-trip in ``submissions``.
Status changes are published to ``tenant:{tenant}:events`` so connected SSE
clients see the live update.
"""
from __future__ import annotations

import base64
from datetime import datetime, timezone
from uuid import UUID

from arq.connections import RedisSettings
from arq.cron import cron
from sqlalchemy import desc, select

from app.config import ZatcaEnv, get_settings
from app.db.models import Csid, Invoice, Submission, Tenant
from app.db.session import SessionLocal
from app.events import publish
from app.zatca.client import ZatcaClient

REPORTING_FAMILY = {
    "simplified_invoice",
    "simplified_credit_note",
    "simplified_debit_note",
    "nominal_supply_invoice",
    "advance_payment_invoice",
}


async def _emit(inv: Invoice, event_type: str, *, error: str | None = None) -> None:
    payload = {
        "invoice_id": str(inv.id),
        "icv": inv.icv,
        "doc_type": inv.doc_type,
        "status": inv.status,
    }
    if error is not None:
        payload["error"] = error[:500]
    await publish(inv.tenant_id, event_type, **payload)


async def submit_invoice_job(ctx: dict, invoice_id: str) -> str:
    inv_uuid = UUID(invoice_id)
    async with SessionLocal() as db:
        inv = await db.scalar(select(Invoice).where(Invoice.id == inv_uuid))
        if inv is None:
            return "missing"
        if inv.status not in {"queued", "retrying"}:
            return f"skip:{inv.status}"

        csid = await db.scalar(
            select(Csid)
            .where(
                Csid.tenant_id == inv.tenant_id,
                Csid.env == inv.env,
                Csid.kind == "production",
                Csid.revoked_at.is_(None),
            )
            .order_by(desc(Csid.issued_at))
        )
        if csid is None:
            inv.status = "failed_no_csid"
            inv.last_error = "no production CSID available"
            await db.commit()
            await _emit(inv, "invoice.failed", error=inv.last_error)
            return "no_csid"

        client = ZatcaClient(ZatcaEnv(inv.env))
        invoice_b64 = base64.b64encode(inv.signed_xml.encode()).decode()
        kind = "reporting" if inv.doc_type in REPORTING_FAMILY else "clearance"
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
            zatca_status=str(resp.body.get("status") or resp.body.get("reportingStatus") or ""),
            attempt=int(ctx.get("job_try", 1)),
            submitted_at=datetime.now(timezone.utc),
        ))

        if 200 <= resp.status_code < 300:
            inv.status = "cleared" if kind == "clearance" else "reported"
            if kind == "clearance":
                cleared = resp.body.get("clearedInvoice")
                if cleared:
                    inv.cleared_xml = base64.b64decode(cleared).decode("utf-8", errors="replace")
            inv.submitted_at = datetime.now(timezone.utc)
            await db.commit()
            await _emit(inv, f"invoice.{inv.status}")
            return "ok"

        if 400 <= resp.status_code < 500:
            inv.status = "rejected"
            inv.last_error = resp.raw_text[:2000]
            await db.commit()
            await _emit(inv, "invoice.rejected", error=inv.last_error)
            return "rejected"

        attempt = int(ctx.get("job_try", 1))
        if attempt >= 5:
            inv.status = "failed_pending_review"
        else:
            inv.status = "retrying"
        inv.last_error = resp.raw_text[:2000]
        await db.commit()
        await _emit(inv, "invoice.retrying" if inv.status == "retrying" else "invoice.failed",
                    error=inv.last_error)
        raise RuntimeError(f"zatca_5xx_{resp.status_code}")


async def submit_queue_tick(ctx: dict) -> dict:
    """Runs every minute. For each tenant whose strategy is "queued" and whose
    schedule (HH:MM list or N-minute interval, depending on
    ``queue_schedule_mode``) matches the current minute, releases *every*
    queued invoice in one batch — no per-tick cap.

    Tenants in "immediate" mode are skipped (those invoices were enqueued at
    submit time). Tenants on "queued" but off-schedule are skipped this tick.
    """
    from arq.connections import create_pool

    from app.api.v1.invoices import _matches_schedule
    from app.db.models.tenant import DEFAULT_QUEUE_SCHEDULE_TIMES

    now = datetime.now(timezone.utc)

    pool = await create_pool(RedisSettings.from_dsn(get_settings().redis_url))
    released_per_tenant: dict[str, int] = {}
    try:
        async with SessionLocal() as db:
            tenants = (await db.execute(select(Tenant))).scalars().all()
            for t in tenants:
                if t.queue_strategy != "queued":
                    continue
                schedule = list(t.queue_schedule_times or DEFAULT_QUEUE_SCHEDULE_TIMES)
                if not _matches_schedule(
                    now,
                    mode=(t.queue_schedule_mode or "times"),
                    times=schedule,
                    interval_minutes=int(t.queue_schedule_interval_minutes or 60),
                ):
                    continue
                pending = (
                    await db.execute(
                        select(Invoice)
                        .where(
                            Invoice.tenant_id == t.id,
                            Invoice.status.in_(["queued", "retrying"]),
                        )
                        .order_by(Invoice.icv.asc())
                    )
                ).scalars().all()
                for inv in pending:
                    await pool.enqueue_job("submit_invoice_job", str(inv.id))
                if pending:
                    released_per_tenant[str(t.id)] = len(pending)
    finally:
        await pool.close()
    return released_per_tenant


class WorkerSettings:
    functions = [submit_invoice_job]
    cron_jobs = [
        cron(
            submit_queue_tick,
            minute=set(range(0, 60)),  # every minute
            run_at_startup=False,
        ),
    ]
    max_tries = 5
    retry_jobs = True

    @staticmethod
    def redis_settings() -> RedisSettings:
        return RedisSettings.from_dsn(get_settings().redis_url)
