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

from datetime import datetime, timezone
from uuid import UUID

from arq.connections import RedisSettings
from arq.cron import cron
from sqlalchemy import select

from app.config import get_settings
from app.db.models import Invoice, Tenant
from app.db.session import SessionLocal
from app.zatca.submitter import REPORTING_FAMILY, submit_invoice_to_zatca  # noqa: F401


async def submit_invoice_job(ctx: dict, invoice_id: str) -> str:
    inv_uuid = UUID(invoice_id)
    async with SessionLocal() as db:
        inv = await db.scalar(select(Invoice).where(Invoice.id == inv_uuid))
        if inv is None:
            return "missing"
        attempt = int(ctx.get("job_try", 1))
        outcome = await submit_invoice_to_zatca(db, inv, attempt=attempt, max_attempts=5)
        await db.commit()
        if outcome == "retrying" and inv.status == "retrying":
            # Re-raise so arq schedules a retry with backoff.
            raise RuntimeError(f"zatca_5xx_retry_{inv.icv}")
        return outcome


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
