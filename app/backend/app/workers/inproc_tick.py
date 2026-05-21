"""In-process queue scheduler.

Runs as a background asyncio task inside the FastAPI process so the queue
moves WITHOUT requiring a separate arq worker + Redis. Ticks once a minute
and, for every tenant whose schedule matches, drains the whole queue
through the shared ``submit_invoice_to_zatca`` submitter.

For multi-server deployments where arq + Redis are the canonical scheduler,
this is redundant but harmless — each invoice is submitted at most once
because ``submit_invoice_to_zatca`` short-circuits on non-queued status.

Architecturally the four submission paths now all converge here too:
  1. user POST /invoices submit_mode=immediate  → inline
  2. user clicks "Release now"                  → inline
  3. user clicks "Process queue now"            → inline (force)
  4. **background scheduled tick (this file)**  → inline
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy import select

from app.db.models import Invoice, Tenant
from app.db.models.tenant import DEFAULT_QUEUE_SCHEDULE_TIMES
from app.db.session import SessionLocal
from app.zatca.submitter import submit_invoice_to_zatca

log = logging.getLogger("inproc_tick")
_TICK_SECONDS = 60


async def _drain_tenant(db, tenant: Tenant) -> int:
    """Submit every queued/retrying invoice for this tenant. Returns count."""
    rows = (
        await db.execute(
            select(Invoice)
            .where(
                Invoice.tenant_id == tenant.id,
                Invoice.status.in_(["queued", "retrying"]),
            )
            .order_by(Invoice.icv.asc())
        )
    ).scalars().all()
    sent = 0
    for inv in rows:
        try:
            await submit_invoice_to_zatca(db, inv)
            await db.commit()
            sent += 1
        except Exception as e:  # noqa: BLE001
            log.warning("inproc-tick submission failed icv=%s err=%s", inv.icv, e)
            await db.rollback()
    return sent


async def _one_tick() -> None:
    # Import inside the function to avoid circular imports with invoices router.
    from app.api.v1.invoices import _matches_schedule

    now = datetime.now(timezone.utc)
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
            count = await _drain_tenant(db, t)
            if count:
                log.info("inproc-tick released %d invoice(s) for tenant=%s", count, t.id)


async def run_forever(stop_event: asyncio.Event) -> None:
    """Tick loop — fires every ``_TICK_SECONDS``. Stops when ``stop_event`` is set."""
    log.info("inproc-tick started (every %ds)", _TICK_SECONDS)
    while not stop_event.is_set():
        try:
            await _one_tick()
        except Exception as e:  # noqa: BLE001
            log.exception("inproc-tick failed: %s", e)
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=_TICK_SECONDS)
        except asyncio.TimeoutError:
            pass
    log.info("inproc-tick stopped")
