"""FastAPI router for ZATCA invoice issuance and submission."""
from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from math import ceil
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import Date, String, cast, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps import CurrentUserDep
from apps.invoices.models import Invoice, Submission
from apps.invoices.schemas import InvoiceCreate, InvoiceLineSchema, PartySchema
from apps.invoices.service import InvoiceService

router = APIRouter(prefix="/invoices", tags=["invoices"])


# --------------------------------------------------------------------------- #
# Helpers                                                                       #
# --------------------------------------------------------------------------- #

def _to_list_item(inv: Invoice) -> dict:
    pj = inv.payload_json or {}
    cust = pj.get("customer") or {}
    lines = pj.get("lines") or []
    payable = None
    try:
        total = Decimal("0")
        for ln in lines:
            price = Decimal(str(ln.get("unit_price", "0")))
            qty = Decimal(str(ln.get("quantity", "1")))
            disc = Decimal(str(ln.get("discount_percent", "0")))
            tax = Decimal(str(ln.get("tax_percent", "15")))
            net = price * qty * (1 - disc / 100)
            total += net + (net * tax / 100)
        payable = str(total.quantize(Decimal("0.01")))
    except Exception:
        pass
    return {
        "id": str(inv.id),
        "icv": inv.icv,
        "doc_type": inv.doc_type,
        "status": inv.status,
        "created_at": inv.created_at.isoformat() if inv.created_at else None,
        "invoice_number": str(inv.icv),
        "customer_name": cust.get("registration_name"),
        "issue_date": pj.get("issue_date"),
        "payable_amount": payable,
    }


def _to_detail(inv: Invoice, submissions: list[Submission]) -> dict:
    return {
        "id": str(inv.id),
        "env": inv.env,
        "uuid": str(inv.uuid),
        "icv": inv.icv,
        "doc_type": inv.doc_type,
        "subtype": inv.subtype,
        "status": inv.status,
        "invoice_hash": inv.invoice_hash,
        "qr_base64": inv.qr_base64,
        "last_error": inv.last_error,
        "payload_json": inv.payload_json or {},
        "signed_xml": inv.signed_xml,
        "cleared_xml": inv.cleared_xml,
        "signed_at": inv.signed_at.isoformat() if inv.signed_at else None,
        "submitted_at": inv.submitted_at.isoformat() if inv.submitted_at else None,
        "created_at": inv.created_at.isoformat() if inv.created_at else None,
        "submissions": [
            {
                "id": str(s.id),
                "kind": s.kind,
                "http_status": s.http_status,
                "zatca_status": s.zatca_status,
                "attempt": s.attempt,
                "submitted_at": s.submitted_at.isoformat() if s.submitted_at else None,
                "response_payload": s.response_payload,
            }
            for s in submissions
        ],
    }


# --------------------------------------------------------------------------- #
# GET /invoices/stats                                                            #
# --------------------------------------------------------------------------- #

@router.get("/stats")
async def invoice_stats(
    user: CurrentUserDep,
    db: AsyncSession = Depends(get_db),
    env: str | None = None,
) -> dict:
    stmt = (
        select(Invoice.status, func.count().label("cnt"))
        .where(Invoice.tenant_id == user.tenant_id)
        .group_by(Invoice.status)
    )
    if env:
        stmt = stmt.where(Invoice.env == env)
    rows = (await db.execute(stmt)).all()
    by_status = {r.status: r.cnt for r in rows}
    return {
        "total":     sum(by_status.values()),
        "cleared":   by_status.get("cleared", 0),
        "reported":  by_status.get("reported", 0),
        "submitted": by_status.get("submitted", 0),
        "failed":    by_status.get("failed", 0),
        "queued":    by_status.get("queued", 0),
        "signed":    by_status.get("signed", 0),
    }


# --------------------------------------------------------------------------- #
# GET /invoices — paginated list with JSONB-based filtering, no N+1             #
# --------------------------------------------------------------------------- #

@router.get("")
async def list_invoices(
    user: CurrentUserDep,
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    statuses: str | None = Query(None),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    q: str | None = Query(None),
    env: str | None = Query(None),
) -> dict:
    stmt = select(Invoice).where(Invoice.tenant_id == user.tenant_id)

    if env:
        stmt = stmt.where(Invoice.env == env)
    if statuses:
        sl = [s.strip() for s in statuses.split(",") if s.strip()]
        if sl:
            stmt = stmt.where(Invoice.status.in_(sl))
    if date_from:
        stmt = stmt.where(
            cast(
                func.jsonb_extract_path_text(Invoice.payload_json, "issue_date"),
                Date,
            ) >= date_from
        )
    if date_to:
        stmt = stmt.where(
            cast(
                func.jsonb_extract_path_text(Invoice.payload_json, "issue_date"),
                Date,
            ) <= date_to
        )
    if q:
        stmt = stmt.where(
            or_(
                func.lower(
                    func.jsonb_extract_path_text(
                        Invoice.payload_json, "customer", "registration_name"
                    )
                ).like(f"%{q.lower()}%"),
                cast(Invoice.icv, String).like(f"{q}%"),
            )
        )

    count_stmt = select(func.count()).select_from(stmt.subquery())
    total: int = (await db.execute(count_stmt)).scalar() or 0

    data_stmt = (
        stmt.order_by(Invoice.created_at.desc())
        .limit(page_size)
        .offset((page - 1) * page_size)
    )
    rows = (await db.execute(data_stmt)).scalars().all()

    return {
        "items": [_to_list_item(r) for r in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": max(1, ceil(total / page_size)),
    }


# --------------------------------------------------------------------------- #
# POST /invoices — create, sign, submit                                         #
# --------------------------------------------------------------------------- #

@router.post("", status_code=status.HTTP_201_CREATED)
async def create_invoice(
    body: InvoiceCreate,
    user: CurrentUserDep,
    db: AsyncSession = Depends(get_db),
) -> dict:
    svc = InvoiceService(db)
    try:
        invoice = await svc.create_and_sign(user.tenant_id, body)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Invoice signing failed: {exc}")

    if body.submit:
        try:
            invoice = await svc.submit_to_zatca(
                invoice.id, user.tenant_id,
                use_compliance_csid=body.use_compliance_csid,
            )
        except Exception:
            pass

    return {
        "id": str(invoice.id),
        "status": invoice.status,
        "invoice_hash": invoice.invoice_hash or "",
        "icv": invoice.icv,
        "submit_mode": "immediate" if body.submit else "draft",
    }


# --------------------------------------------------------------------------- #
# POST /invoices/batch                                                           #
# --------------------------------------------------------------------------- #

class _BatchBody(BaseModel):
    env: str = "sandbox"
    payloads: list[InvoiceCreate]
    submit_mode: str = "immediate"


@router.post("/batch")
async def submit_batch(
    body: _BatchBody,
    user: CurrentUserDep,
    db: AsyncSession = Depends(get_db),
) -> dict:
    svc = InvoiceService(db)
    batch_id = str(uuid4())
    items = []
    accepted = 0
    for payload in body.payloads:
        try:
            invoice = await svc.create_and_sign(user.tenant_id, payload)
            if body.submit_mode == "immediate":
                try:
                    invoice = await svc.submit_to_zatca(invoice.id, user.tenant_id)
                except Exception:
                    pass
            items.append({
                "id": str(invoice.id),
                "status": invoice.status,
                "invoice_hash": invoice.invoice_hash or "",
                "icv": invoice.icv,
            })
            accepted += 1
        except Exception:
            pass
    return {"batch_id": batch_id, "accepted": accepted, "items": items}


# --------------------------------------------------------------------------- #
# POST /invoices/demo-seed                                                       #
# --------------------------------------------------------------------------- #

class _DemoSeedBody(BaseModel):
    env: str = "sandbox"
    bitmask: str = "1100"


@router.post("/demo-seed")
async def demo_seed(
    body: _DemoSeedBody,
    user: CurrentUserDep,
    db: AsyncSession = Depends(get_db),
) -> dict:
    svc = InvoiceService(db)
    demo_customer = PartySchema(
        registration_name="Demo Customer LLC",
        vat_number="300000000000003",
        city="Riyadh",
        postal_zone="12345",
    )
    demo_lines = [
        InvoiceLineSchema(
            id="1", name="Demo Service",
            quantity=Decimal("1"), unit_price=Decimal("100"),
            tax_percent=Decimal("15"),
        )
    ]
    bitmask = body.bitmask.ljust(4, "0")
    doc_types: list[str] = []
    if bitmask[0] == "1":
        doc_types.append("standard_invoice")
    if len(bitmask) > 1 and bitmask[1] == "1":
        doc_types.append("simplified_invoice")

    invoice_ids: list[str] = []
    created = 0
    for doc_type in doc_types:
        for _ in range(2):
            try:
                env_literal = body.env if body.env in ("sandbox", "simulation", "production") else "sandbox"
                inv = await svc.create_and_sign(
                    user.tenant_id,
                    InvoiceCreate(
                        env=env_literal,  # type: ignore[arg-type]
                        doc_type=doc_type,
                        customer=demo_customer,
                        lines=demo_lines,
                        use_compliance_csid=False,
                        submit=False,
                    ),
                )
                invoice_ids.append(str(inv.id))
                created += 1
            except Exception:
                pass
    return {"created": created, "invoice_ids": invoice_ids, "used_dev_csid": False}


# --------------------------------------------------------------------------- #
# POST /invoices/bulk-promote                                                    #
# --------------------------------------------------------------------------- #

class _BulkPromoteBody(BaseModel):
    ids: list[str]
    submit_now: bool = False


@router.post("/bulk-promote")
async def bulk_promote(
    body: _BulkPromoteBody,
    user: CurrentUserDep,
    db: AsyncSession = Depends(get_db),
) -> dict:
    if not body.ids:
        return {"queued": 0, "skipped": 0, "submitting": False, "invoice_ids": []}

    uuids = [UUID(i) for i in body.ids if _valid_uuid(i)]
    rows = (
        await db.execute(
            select(Invoice).where(Invoice.id.in_(uuids), Invoice.tenant_id == user.tenant_id)
        )
    ).scalars().all()

    promoted_ids: list[str] = []
    skipped = len(body.ids) - len(rows)
    for inv in rows:
        if inv.status in ("signed", "failed"):
            inv.status = "queued"
            promoted_ids.append(str(inv.id))
        else:
            skipped += 1
    await db.commit()

    submitting = False
    if body.submit_now and promoted_ids:
        svc = InvoiceService(db)
        for inv_id in promoted_ids:
            try:
                await svc.submit_to_zatca(UUID(inv_id), user.tenant_id)
            except Exception:
                pass
        submitting = True

    return {
        "queued": len(promoted_ids),
        "skipped": skipped,
        "submitting": submitting,
        "invoice_ids": promoted_ids,
    }


def _valid_uuid(s: str) -> bool:
    try:
        UUID(s); return True
    except ValueError:
        return False


# --------------------------------------------------------------------------- #
# POST /invoices/process-queue                                                   #
# --------------------------------------------------------------------------- #

class _ProcessQueueBody(BaseModel):
    force: bool = False


@router.post("/process-queue")
async def process_queue(
    body: _ProcessQueueBody,
    user: CurrentUserDep,
    db: AsyncSession = Depends(get_db),
) -> dict:
    from apps.auth.models import Tenant
    tenant = (
        await db.execute(select(Tenant).where(Tenant.id == user.tenant_id))
    ).scalar_one_or_none()

    schedule_mode = tenant.queue_schedule_mode if tenant else "times"
    schedule_times: list[str] = tenant.queue_schedule_times if tenant else []
    schedule_interval = tenant.queue_schedule_interval_minutes if tenant else 60

    skipped_reason = None
    if not body.force:
        current_hhmm = datetime.now(timezone.utc).strftime("%H:%M")
        if schedule_mode == "times" and current_hhmm not in (schedule_times or []):
            skipped_reason = f"current_time_{current_hhmm}_not_in_schedule"

    queued_rows = (
        await db.execute(
            select(Invoice)
            .where(Invoice.tenant_id == user.tenant_id, Invoice.status == "queued")
            .order_by(Invoice.created_at)
        )
    ).scalars().all()

    released = 0
    remaining = len(queued_rows)
    if not skipped_reason:
        svc = InvoiceService(db)
        for inv in queued_rows:
            try:
                await svc.submit_to_zatca(inv.id, user.tenant_id)
                released += 1
            except Exception:
                pass
        remaining = remaining - released

    return {
        "released": released,
        "remaining_queued": remaining,
        "schedule_mode": schedule_mode,
        "schedule_times": schedule_times or [],
        "schedule_interval_minutes": schedule_interval,
        "skipped_reason": skipped_reason,
    }


# --------------------------------------------------------------------------- #
# GET /invoices/{id} — detail with submissions                                  #
# --------------------------------------------------------------------------- #

@router.get("/{id}")
async def get_invoice(
    id: UUID,
    user: CurrentUserDep,
    db: AsyncSession = Depends(get_db),
) -> dict:
    invoice = await db.get(Invoice, id)
    if invoice is None or invoice.tenant_id != user.tenant_id:
        raise HTTPException(status_code=404, detail="invoice_not_found")
    subs = (
        await db.execute(
            select(Submission).where(Submission.invoice_id == id).order_by(Submission.submitted_at)
        )
    ).scalars().all()
    return _to_detail(invoice, list(subs))


# --------------------------------------------------------------------------- #
# PUT /invoices/{id} — edit in-place (same ICV, re-sign on next submit)         #
# --------------------------------------------------------------------------- #

class _ReplaceBody(BaseModel):
    payload: dict
    submit_mode: str = "draft"


@router.put("/{id}")
async def replace_invoice(
    id: UUID,
    body: _ReplaceBody,
    user: CurrentUserDep,
    db: AsyncSession = Depends(get_db),
) -> dict:
    invoice = await db.get(Invoice, id)
    if invoice is None or invoice.tenant_id != user.tenant_id:
        raise HTTPException(status_code=404, detail="invoice_not_found")
    if invoice.status in ("cleared", "reported"):
        raise HTTPException(status_code=409, detail="invoice_already_issued")
    invoice.payload_json = body.payload
    invoice.status = "queued" if body.submit_mode == "queued" else "signed"
    await db.commit()
    await db.refresh(invoice)
    return {
        "id": str(invoice.id),
        "status": invoice.status,
        "invoice_hash": invoice.invoice_hash or "",
        "icv": invoice.icv,
        "submit_mode": body.submit_mode,
    }


# --------------------------------------------------------------------------- #
# POST /invoices/{id}/submit — re-submit to ZATCA                               #
# --------------------------------------------------------------------------- #

@router.post("/{id}/submit")
async def submit_invoice(
    id: UUID,
    user: CurrentUserDep,
    db: AsyncSession = Depends(get_db),
) -> dict:
    invoice = await db.get(Invoice, id)
    if invoice is None or invoice.tenant_id != user.tenant_id:
        raise HTTPException(status_code=404, detail="invoice_not_found")
    svc = InvoiceService(db)
    try:
        invoice = await svc.submit_to_zatca(id, user.tenant_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Submission failed: {exc}")
    return {
        "id": str(invoice.id),
        "status": invoice.status,
        "invoice_hash": invoice.invoice_hash or "",
        "icv": invoice.icv,
    }


# --------------------------------------------------------------------------- #
# POST /invoices/{id}/release                                                    #
# --------------------------------------------------------------------------- #

@router.post("/{id}/release")
async def release_invoice(
    id: UUID,
    user: CurrentUserDep,
    db: AsyncSession = Depends(get_db),
) -> dict:
    invoice = await db.get(Invoice, id)
    if invoice is None or invoice.tenant_id != user.tenant_id:
        raise HTTPException(status_code=404, detail="invoice_not_found")
    svc = InvoiceService(db)
    try:
        invoice = await svc.submit_to_zatca(id, user.tenant_id)
    except Exception:
        pass
    return {"id": str(invoice.id), "status": invoice.status, "submit_mode": "inline"}


# --------------------------------------------------------------------------- #
# POST /invoices/{id}/retry                                                      #
# --------------------------------------------------------------------------- #

@router.post("/{id}/retry")
async def retry_invoice(
    id: UUID,
    user: CurrentUserDep,
    db: AsyncSession = Depends(get_db),
) -> dict:
    invoice = await db.get(Invoice, id)
    if invoice is None or invoice.tenant_id != user.tenant_id:
        raise HTTPException(status_code=404, detail="invoice_not_found")
    if invoice.status not in ("failed", "submitted", "signed", "queued"):
        raise HTTPException(status_code=400, detail="invoice_not_retryable")
    svc = InvoiceService(db)
    try:
        invoice = await svc.submit_to_zatca(id, user.tenant_id)
    except Exception:
        pass
    return {
        "id": str(invoice.id),
        "status": invoice.status,
        "icv": invoice.icv,
        "last_error": invoice.last_error,
        "resigned": False,
    }


# --------------------------------------------------------------------------- #
# POST /invoices/{id}/promote                                                    #
# --------------------------------------------------------------------------- #

class _PromoteBody(BaseModel):
    submit_now: bool = False


@router.post("/{id}/promote")
async def promote_draft(
    id: UUID,
    body: _PromoteBody,
    user: CurrentUserDep,
    db: AsyncSession = Depends(get_db),
) -> dict:
    invoice = await db.get(Invoice, id)
    if invoice is None or invoice.tenant_id != user.tenant_id:
        raise HTTPException(status_code=404, detail="invoice_not_found")

    submit_mode = "arq"
    if body.submit_now:
        svc = InvoiceService(db)
        try:
            invoice = await svc.submit_to_zatca(id, user.tenant_id)
            submit_mode = "inline"
        except Exception:
            invoice.status = "queued"
            await db.commit()
            await db.refresh(invoice)
    else:
        if invoice.status in ("signed", "failed"):
            invoice.status = "queued"
            await db.commit()
            await db.refresh(invoice)
    return {"id": str(invoice.id), "status": invoice.status, "submit_mode": submit_mode}


# --------------------------------------------------------------------------- #
# POST /invoices/{id}/resign                                                     #
# --------------------------------------------------------------------------- #

@router.post("/{id}/resign")
async def resign_invoice(
    id: UUID,
    user: CurrentUserDep,
    db: AsyncSession = Depends(get_db),
) -> dict:
    invoice = await db.get(Invoice, id)
    if invoice is None or invoice.tenant_id != user.tenant_id:
        raise HTTPException(status_code=404, detail="invoice_not_found")
    subs = (
        await db.execute(
            select(Submission).where(Submission.invoice_id == id).order_by(Submission.submitted_at)
        )
    ).scalars().all()
    return _to_detail(invoice, list(subs))


# --------------------------------------------------------------------------- #
# POST /invoices/{id}/amend — auto CN/DN for delta                              #
# --------------------------------------------------------------------------- #

class _AmendBody(BaseModel):
    new_payable: str
    reason: str


@router.post("/{id}/amend")
async def amend_invoice(
    id: UUID,
    body: _AmendBody,
    user: CurrentUserDep,
    db: AsyncSession = Depends(get_db),
) -> dict:
    invoice = await db.get(Invoice, id)
    if invoice is None or invoice.tenant_id != user.tenant_id:
        raise HTTPException(status_code=404, detail="invoice_not_found")
    if invoice.status not in ("cleared", "reported"):
        raise HTTPException(status_code=400, detail="invoice_not_issued")

    pj = invoice.payload_json or {}
    lines = pj.get("lines") or []
    original_total = Decimal("0")
    for ln in lines:
        price = Decimal(str(ln.get("unit_price", "0")))
        qty = Decimal(str(ln.get("quantity", "1")))
        disc = Decimal(str(ln.get("discount_percent", "0")))
        tax = Decimal(str(ln.get("tax_percent", "15")))
        net = price * qty * (1 - disc / 100)
        original_total += net + (net * tax / 100)
    original_total = original_total.quantize(Decimal("0.01"))

    new_payable = Decimal(body.new_payable).quantize(Decimal("0.01"))
    delta = new_payable - original_total
    note_kind = "credit_note" if delta < 0 else "debit_note"
    is_standard = invoice.subtype.startswith("01")
    note_doc_type = (
        "standard_credit_note" if is_standard else "simplified_credit_note"
    ) if delta < 0 else (
        "standard_debit_note" if is_standard else "simplified_debit_note"
    )

    note_base = (abs(delta) / Decimal("1.15")).quantize(Decimal("0.01"))
    note_lines = [
        InvoiceLineSchema(
            id="1",
            name=f"Adjustment — {body.reason}"[:80],
            quantity=Decimal("1"),
            unit_price=note_base,
            tax_percent=Decimal("15"),
        )
    ]
    cust_data = pj.get("customer") or {}
    try:
        note_customer = PartySchema(**cust_data)
    except Exception:
        note_customer = PartySchema(
            registration_name=cust_data.get("registration_name", "Customer")
        )

    env_val = pj.get("env", "sandbox")
    if env_val not in ("sandbox", "simulation", "production"):
        env_val = "sandbox"

    svc = InvoiceService(db)
    note_inv = await svc.create_and_sign(
        user.tenant_id,
        InvoiceCreate(
            env=env_val,  # type: ignore[arg-type]
            doc_type=note_doc_type,
            customer=note_customer,
            lines=note_lines,
            billing_reference_id=str(invoice.icv),
            instruction_note=body.reason,
            use_compliance_csid=False,
            submit=True,
        ),
    )

    return {
        "note_kind": note_kind,
        "delta": str(delta),
        "note_invoice_id": str(note_inv.id),
        "note_icv": note_inv.icv,
        "references": str(invoice.icv),
    }
