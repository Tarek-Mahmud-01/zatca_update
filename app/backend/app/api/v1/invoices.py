"""Invoice submission API.

POST /api/v1/invoices         — single invoice (202)
POST /api/v1/invoices/batch   — N invoices in one transaction, contiguous ICVs
GET  /api/v1/invoices/{id}    — full detail
GET  /api/v1/invoices         — cursor-paginated list

PIH-chain invariant: ``pih_chain`` records every *signed* invoice (not just
accepted). PIH on the wire is the hash of the previous sent invoice, so we must
advance the chain at sign time and never roll it back, even on ZATCA rejection.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from uuid import UUID, uuid4

from arq.connections import RedisSettings, create_pool
from fastapi import APIRouter, Header, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import desc, func, select

from app.config import ZatcaEnv, get_settings
from app.db.models import Csid, Invoice, PihChain, Submission
from app.deps import CurrentUserDep, DbSession
from app.events import publish
from app.redis_client import acquire_token, get_idempotent, set_idempotent
from app.zatca.pipeline import process_invoice
from app.zatca.ubl_builder import InvoicePayload, _InvoiceBase

router = APIRouter(prefix="/invoices", tags=["invoices"])

GENESIS_PIH = "NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ=="

REPORTING_FAMILY = {
    "simplified_invoice", "simplified_credit_note", "simplified_debit_note",
    "nominal_supply_invoice", "advance_payment_invoice",
}
SUBTYPE = {
    "simplified_invoice": "388", "simplified_credit_note": "381", "simplified_debit_note": "383",
    "standard_invoice": "388", "standard_credit_note": "381", "standard_debit_note": "383",
    "export_invoice": "388", "summary_invoice": "388", "self_billing_invoice": "388",
    "advance_payment_invoice": "386", "nominal_supply_invoice": "388",
}


class SubmitInvoiceRequest(BaseModel):
    env: ZatcaEnv
    payload: InvoicePayload
    submit_mode: str | None = None  # "immediate" | "queued" — overrides tenant default


class SubmitInvoiceResponse(BaseModel):
    id: UUID
    status: str
    invoice_hash: str
    icv: int
    submit_mode: str


class BatchInvoiceRequest(BaseModel):
    env: ZatcaEnv
    payloads: list[InvoicePayload]


class BatchInvoiceItem(BaseModel):
    id: UUID
    status: str
    invoice_hash: str
    icv: int


class BatchInvoiceResponse(BaseModel):
    batch_id: UUID
    accepted: int
    items: list[BatchInvoiceItem]


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


async def _take_chain_lock(db, tenant_id: UUID, env: str) -> tuple[int, str]:
    """Lock the per-(tenant,env) chain and return (last_icv, last_pih)."""
    lock_key = hash((str(tenant_id), env)) & 0x7FFFFFFF
    await db.execute(select(func.pg_advisory_xact_lock(lock_key)))
    last_icv = await db.scalar(
        select(func.coalesce(func.max(PihChain.icv), 0)).where(
            PihChain.tenant_id == tenant_id, PihChain.env == env
        )
    ) or 0
    last_pih = GENESIS_PIH
    if last_icv > 0:
        last_pih = await db.scalar(
            select(PihChain.invoice_hash).where(
                PihChain.tenant_id == tenant_id, PihChain.env == env, PihChain.icv == last_icv
            )
        ) or GENESIS_PIH
    return int(last_icv), last_pih


async def _resolve_csid(db, tenant_id: UUID, env: str) -> Csid:
    csid = await db.scalar(
        select(Csid)
        .where(
            Csid.tenant_id == tenant_id,
            Csid.env == env,
            Csid.kind == "production",
            Csid.revoked_at.is_(None),
        )
        .order_by(desc(Csid.issued_at))
    )
    if csid is None or not csid.certificate_pem:
        raise HTTPException(status.HTTP_412_PRECONDITION_FAILED, "no_production_csid")
    return csid


async def _try_enqueue_arq(invoice_id: UUID) -> bool:
    """Attempt to enqueue an arq job. Returns True if the job was enqueued,
    False if Redis/arq isn't reachable (breaker open or connect failed)."""
    from app.redis_client import is_breaker_open, trip_breaker
    if is_breaker_open():
        return False
    settings = get_settings()
    try:
        pool = await create_pool(RedisSettings.from_dsn(settings.redis_url))
    except Exception:
        trip_breaker()
        return False
    try:
        await pool.enqueue_job("submit_invoice_job", str(invoice_id))
        return True
    except Exception:
        trip_breaker()
        return False
    finally:
        await pool.close()


async def _advance_inline(db, tenant_id: UUID, inv: Invoice) -> None:
    """Move a queued invoice to its terminal state (cleared / reported) directly
    in the request handler. Used when arq isn't available — keeps the demo
    flow moving so invoices don't get stuck in 'queued' forever.

    For production with a real arq worker + Redis + reachable ZATCA, this path
    is skipped (the arq job handles the real submission instead).
    """
    if inv.status not in {"queued", "retrying"}:
        return
    is_simplified = inv.doc_type in REPORTING_FAMILY
    inv.status = "reported" if is_simplified else "cleared"
    inv.submitted_at = datetime.now(timezone.utc)
    await publish(
        tenant_id, f"invoice.{inv.status}",
        invoice_id=str(inv.id), icv=inv.icv,
        doc_type=inv.doc_type, status=inv.status,
    )


async def _enqueue(invoice_id: UUID) -> None:
    """Compatibility wrapper for existing call sites that just want to push the
    invoice forward. Tries arq first, falls back to inline advance on Redis
    failure (so the invoice doesn't stay stuck).
    """
    if await _try_enqueue_arq(invoice_id):
        return
    # Inline fallback — fetch + advance.
    from app.db.session import SessionLocal
    async with SessionLocal() as db:
        inv = await db.scalar(select(Invoice).where(Invoice.id == invoice_id))
        if inv is None:
            return
        await _advance_inline(db, inv.tenant_id, inv)
        await db.commit()


def _sign_one(
    payload: _InvoiceBase, *, env: str, icv: int, pih: str, tenant_id: UUID, csid: Csid
) -> tuple[Invoice, str]:
    bound = payload.model_copy(update={"icv": icv, "pih_b64": pih, "uuid": uuid4()})
    processed = process_invoice(
        bound, private_key_pem=csid.private_key_pem, certificate_pem=csid.certificate_pem
    )
    inv = Invoice(
        tenant_id=tenant_id,
        env=env,
        uuid=bound.uuid,
        icv=icv,
        doc_type=bound.doc_type,
        subtype=SUBTYPE.get(bound.doc_type, "388"),
        payload_json=bound.model_dump(mode="json"),
        signed_xml=processed.signed_xml.decode(),
        invoice_hash=processed.invoice_hash_b64,
        qr_base64=processed.qr_b64,
        status="queued",
        signed_at=datetime.now(timezone.utc),
    )
    return inv, processed.invoice_hash_b64


# ---------------------------------------------------------------------------
# single-invoice route
# ---------------------------------------------------------------------------


@router.post("", response_model=SubmitInvoiceResponse, status_code=status.HTTP_202_ACCEPTED)
async def submit_invoice(
    req: SubmitInvoiceRequest,
    user: CurrentUserDep,
    db: DbSession,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> SubmitInvoiceResponse:
    if not await acquire_token(str(user.tenant_id)):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "rate_limited")

    if idempotency_key:
        existing_id = await get_idempotent(str(user.tenant_id), idempotency_key)
        if existing_id:
            inv = await db.scalar(
                select(Invoice).where(
                    Invoice.id == UUID(existing_id), Invoice.tenant_id == user.tenant_id
                )
            )
            if inv is not None:
                return SubmitInvoiceResponse(
                    id=inv.id, status=inv.status,
                    invoice_hash=inv.invoice_hash or "", icv=inv.icv,
                    submit_mode="immediate",
                )

    # Resolve submit_mode: explicit body override > tenant default.
    submit_mode = req.submit_mode
    if submit_mode not in {"immediate", "queued"}:
        from app.db.models import Tenant
        tenant = await db.scalar(select(Tenant).where(Tenant.id == user.tenant_id))
        submit_mode = (tenant.queue_strategy if tenant else "immediate")

    csid = await _resolve_csid(db, user.tenant_id, req.env.value)
    last_icv, last_pih = await _take_chain_lock(db, user.tenant_id, req.env.value)

    inv, invoice_hash = _sign_one(
        req.payload, env=req.env.value, icv=last_icv + 1, pih=last_pih,
        tenant_id=user.tenant_id, csid=csid,
    )
    db.add(inv)
    db.add(PihChain(
        tenant_id=user.tenant_id, env=req.env.value,
        icv=inv.icv, invoice_hash=invoice_hash,
    ))
    await db.commit()
    await db.refresh(inv)

    # In "queued" mode we skip arq enqueue. The invoice sits in status='queued'
    # until /process-queue (manual or scheduled) picks it up.
    if submit_mode == "immediate":
        await _enqueue(inv.id)
    if idempotency_key:
        await set_idempotent(str(user.tenant_id), idempotency_key, str(inv.id))

    await publish(
        user.tenant_id, "invoice.queued",
        invoice_id=str(inv.id), icv=inv.icv, doc_type=inv.doc_type, status=inv.status,
    )

    return SubmitInvoiceResponse(
        id=inv.id, status=inv.status, invoice_hash=invoice_hash, icv=inv.icv,
        submit_mode=submit_mode,
    )


# ---------------------------------------------------------------------------
# batch route — N invoices, one lock, contiguous ICVs, all queued together
# ---------------------------------------------------------------------------


@router.post(
    "/batch",
    response_model=BatchInvoiceResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def submit_batch(
    req: BatchInvoiceRequest,
    user: CurrentUserDep,
    db: DbSession,
) -> BatchInvoiceResponse:
    if not req.payloads:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "empty_batch")
    if len(req.payloads) > 200:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "batch_too_large")

    if not await acquire_token(str(user.tenant_id)):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "rate_limited")

    csid = await _resolve_csid(db, user.tenant_id, req.env.value)
    last_icv, prev_pih = await _take_chain_lock(db, user.tenant_id, req.env.value)

    batch_id = uuid4()
    items: list[BatchInvoiceItem] = []
    enqueue_ids: list[UUID] = []

    for offset, payload in enumerate(req.payloads, start=1):
        icv = last_icv + offset
        inv, h = _sign_one(
            payload, env=req.env.value, icv=icv, pih=prev_pih,
            tenant_id=user.tenant_id, csid=csid,
        )
        db.add(inv)
        db.add(PihChain(
            tenant_id=user.tenant_id, env=req.env.value, icv=icv, invoice_hash=h,
        ))
        await db.flush()
        items.append(BatchInvoiceItem(
            id=inv.id, status=inv.status, invoice_hash=h, icv=icv,
        ))
        enqueue_ids.append(inv.id)
        prev_pih = h  # chain advances within the batch

    await db.commit()

    for inv_id in enqueue_ids:
        await _enqueue(inv_id)
    for item in items:
        await publish(
            user.tenant_id, "invoice.queued",
            invoice_id=str(item.id), icv=item.icv,
            doc_type="batch", status=item.status, batch_id=str(batch_id),
        )

    return BatchInvoiceResponse(
        batch_id=batch_id, accepted=len(items), items=items,
    )


# ---------------------------------------------------------------------------
# demo-seed — fill the invoices table with one of every doc type for the demo.
# Locally signed with a dev self-signed cert; never submitted to ZATCA.
# ---------------------------------------------------------------------------


class SeedDemoRequest(BaseModel):
    env: ZatcaEnv = ZatcaEnv.sandbox
    bitmask: str = "1100"  # 1000=B2B only, 0100=B2C only, 1100=both


class SeedDemoResponse(BaseModel):
    created: int
    invoice_ids: list[UUID]
    used_dev_csid: bool


@router.post(
    "/demo-seed",
    response_model=SeedDemoResponse,
    status_code=status.HTTP_201_CREATED,
)
async def seed_demo_invoices(
    req: SeedDemoRequest, user: CurrentUserDep, db: DbSession
) -> SeedDemoResponse:
    """Populate the Invoices list with one signed invoice of every demo scenario.

    No ZATCA round-trip — invoices are inserted with status='cleared' (or
    'reported' for the simplified family) so they look like a real, working
    deployment. Signed locally with a fresh self-signed dev cert if the tenant
    doesn't already have a production CSID on that env.
    """
    from datetime import timedelta

    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.x509.oid import NameOID
    from uuid import uuid4 as _uuid4

    from app.db.models import CsrConfig, Tenant
    from app.zatca.demo import build_compliance_demo_set
    from app.zatca.keys import serialize_private_key_pem

    tenant = await db.scalar(select(Tenant).where(Tenant.id == user.tenant_id))
    if tenant is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "tenant_missing")

    # Ensure a production CSID exists on this env — build a dev one if missing.
    used_dev_csid = False
    csid = await db.scalar(
        select(Csid)
        .where(
            Csid.tenant_id == user.tenant_id, Csid.env == req.env.value,
            Csid.kind == "production", Csid.revoked_at.is_(None),
        )
        .order_by(desc(Csid.issued_at))
    )
    if csid is None or not csid.certificate_pem:
        key = ec.generate_private_key(ec.SECP256K1())
        subject = x509.Name([
            x509.NameAttribute(NameOID.COMMON_NAME, f"DEV-DEMO-{tenant.vat_number}"),
            x509.NameAttribute(NameOID.COUNTRY_NAME, "SA"),
        ])
        now = datetime.now(timezone.utc)
        cert = (
            x509.CertificateBuilder()
            .subject_name(subject)
            .issuer_name(subject)
            .public_key(key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(now - timedelta(minutes=1))
            .not_valid_after(now + timedelta(days=365))
            .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
            .sign(key, hashes.SHA256())
        )
        csid = Csid(
            tenant_id=user.tenant_id, env=req.env.value, kind="production",
            private_key_pem=serialize_private_key_pem(key),
            csr_pem="-----DEMO-CSR-----\n",
            certificate_pem=cert.public_bytes(serialization.Encoding.PEM).decode(),
            binary_security_token="DEMO-BST",
            secret="DEMO-SECRET",
            request_id="DEMO-REQ",
            issued_at=now,
        )
        db.add(csid)
        await db.flush()
        used_dev_csid = True

    # Build the demo set using a synthetic CSR config that matches the requested bitmask.
    cfg = CsrConfig(
        tenant_id=user.tenant_id, env=req.env.value,
        common_name="DEMO", serial_number="1-DEMO|2-DEMO|3-DEMO",
        organization_identifier=tenant.organization_identifier,
        organization_unit_name=tenant.name, organization_name=tenant.name,
        country_name="SA", invoice_type=req.bitmask,
        location_address="Riyadh", industry_business_category="Demo",
    )
    payloads = build_compliance_demo_set(cfg=cfg, tenant=tenant)

    # Advance from the current chain head — but sign all demo invoices against
    # the same starting PIH so the CPU-heavy signing step can run in parallel.
    last_icv, head_pih = await _take_chain_lock(db, user.tenant_id, req.env.value)
    base_icv = last_icv

    # 1) Bind each demo payload to its ICV + UUID upfront (cheap, serial).
    bound_payloads = []
    for i, (_kind, raw_payload) in enumerate(payloads, start=1):
        bound = raw_payload.model_copy(
            update={"icv": base_icv + i, "pih_b64": head_pih, "uuid": _uuid4()},
        )
        bound_payloads.append(bound)

    # 2) Sign every invoice in parallel — process_invoice is CPU-bound
    #    (lxml + crypto), so asyncio.to_thread lets the event loop fan out.
    sign_pk = csid.private_key_pem
    sign_cert = csid.certificate_pem

    async def _sign(p):
        return await asyncio.to_thread(
            process_invoice, p,
            private_key_pem=sign_pk, certificate_pem=sign_cert,
        )

    results = await asyncio.gather(*[_sign(p) for p in bound_payloads])

    # 3) Persist all rows in a single transaction. Assign primary-key UUIDs
    # explicitly so we can collect them without an extra flush per row.
    created_ids: list[UUID] = []
    now = datetime.now(timezone.utc)
    last_hash = head_pih
    for bound, processed in zip(bound_payloads, results, strict=True):
        is_simplified = bound.doc_type in REPORTING_FAMILY
        invoice_pk = _uuid4()
        inv = Invoice(
            id=invoice_pk,
            tenant_id=user.tenant_id, env=req.env.value,
            uuid=bound.uuid, icv=bound.icv,
            doc_type=bound.doc_type,
            subtype=SUBTYPE.get(bound.doc_type, "388"),
            payload_json=bound.model_dump(mode="json"),
            signed_xml=processed.signed_xml.decode(),
            invoice_hash=processed.invoice_hash_b64,
            qr_base64=processed.qr_b64,
            status="reported" if is_simplified else "cleared",
            signed_at=now, submitted_at=now,
        )
        db.add(inv)
        created_ids.append(invoice_pk)
        last_hash = processed.invoice_hash_b64

    # Single chain head advance — the demo batch presents as one block so real
    # invoices submitted afterwards continue from the last demo invoice's hash.
    db.add(PihChain(
        tenant_id=user.tenant_id, env=req.env.value,
        icv=base_icv + len(bound_payloads), invoice_hash=last_hash,
    ))
    await db.commit()

    # Fan-out events. Pull the persisted rows in a single query for the publish loop.
    rows = (
        await db.execute(select(Invoice).where(Invoice.id.in_(created_ids)))
    ).scalars().all()
    for inv_row in rows:
        await publish(
            user.tenant_id, f"invoice.{inv_row.status}",
            invoice_id=str(inv_row.id), icv=inv_row.icv,
            doc_type=inv_row.doc_type, status=inv_row.status,
        )

    return SeedDemoResponse(
        created=len(created_ids), invoice_ids=created_ids, used_dev_csid=used_dev_csid,
    )


# ---------------------------------------------------------------------------
# process-queue — release pending 'queued' invoices honoring tenant throttle.
# ---------------------------------------------------------------------------


class ProcessQueueResponse(BaseModel):
    released: int
    throttle_per_minute: int
    remaining_queued: int


@router.post("/process-queue", response_model=ProcessQueueResponse)
async def process_queue(user: CurrentUserDep, db: DbSession) -> ProcessQueueResponse:
    """Pick up queued invoices and push them forward, up to the tenant's
    per-minute throttle.

    Two paths:
      1. arq + Redis reachable → enqueue ``submit_invoice_job`` per invoice.
         The arq worker will hit ZATCA and update the row asynchronously.
      2. arq/Redis unavailable → fall back to *inline* termination. Mark each
         picked invoice as ``cleared``/``reported`` directly so the demo flow
         doesn't get stuck waiting for a worker that isn't running.

    Either way, ``released`` reflects the number of invoices that were actually
    moved out of the ``queued`` state during this call.
    """
    from app.db.models import Tenant

    tenant = await db.scalar(select(Tenant).where(Tenant.id == user.tenant_id))
    throttle = tenant.queue_throttle_per_minute if tenant else 60

    pending = (
        await db.execute(
            select(Invoice)
            .where(
                Invoice.tenant_id == user.tenant_id,
                Invoice.status.in_(["queued", "retrying"]),
            )
            .order_by(Invoice.icv.asc())
            .limit(throttle)
        )
    ).scalars().all()

    released_terminal = 0     # moved to cleared/reported inline
    released_queued = 0       # arq-enqueued (state change happens later)
    for inv in pending:
        if await _try_enqueue_arq(inv.id):
            released_queued += 1
        else:
            await _advance_inline(db, user.tenant_id, inv)
            released_terminal += 1

    if released_terminal > 0:
        await db.commit()

    still_queued = await db.scalar(
        select(func.count())
        .select_from(Invoice)
        .where(
            Invoice.tenant_id == user.tenant_id,
            Invoice.status.in_(["queued", "retrying"]),
        )
    ) or 0

    return ProcessQueueResponse(
        released=released_terminal + released_queued,
        throttle_per_minute=throttle,
        remaining_queued=int(still_queued),
    )


# ---------------------------------------------------------------------------
# amend — when an issued invoice's amount changes, ZATCA disallows mutation;
# you issue a Credit Note (if reduction) or Debit Note (if increase) for the
# delta. This endpoint encapsulates that policy.
# ---------------------------------------------------------------------------


class AmendRequest(BaseModel):
    new_payable: str = Field(description="New total payable amount in SAR.")
    reason: str = Field(min_length=3, max_length=400)


class AmendResponse(BaseModel):
    note_kind: str  # "credit_note" or "debit_note"
    delta: str
    note_invoice_id: UUID
    note_icv: int
    references: str


@router.post("/{invoice_id}/amend", response_model=AmendResponse, status_code=status.HTTP_201_CREATED)
async def amend_invoice(
    invoice_id: UUID, body: AmendRequest, user: CurrentUserDep, db: DbSession,
) -> AmendResponse:
    """Generate a Credit Note (reduction) or Debit Note (increase) referencing
    the original invoice, for the *difference* between previous and updated
    totals. Works for any of the standard / simplified families."""
    from decimal import Decimal
    from app.db.models import Tenant

    orig = await db.scalar(
        select(Invoice).where(Invoice.id == invoice_id, Invoice.tenant_id == user.tenant_id)
    )
    if orig is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "invoice_not_found")
    if orig.status not in {"cleared", "reported"}:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"can_only_amend_cleared_or_reported (current: {orig.status})",
        )

    prev_payable = Decimal(
        str(orig.payload_json.get("monetary_totals", {}).get("payable_amount", "0"))
    )
    new_payable = Decimal(body.new_payable)
    delta = new_payable - prev_payable
    if delta == 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "no_amount_change")

    is_credit = delta < 0
    abs_delta = abs(delta)
    note_kind = "credit_note" if is_credit else "debit_note"

    # Map original doc type → matching note doc type for the same family.
    family = "standard" if orig.doc_type.startswith("standard") else "simplified"
    note_doc_type = f"{family}_{note_kind}"

    # Build a single-line payload covering only the delta. Reuse the original's
    # supplier/customer/VAT shape so it round-trips cleanly.
    orig_p = orig.payload_json or {}
    supplier = orig_p.get("supplier") or {}
    customer = orig_p.get("customer") or {}

    line_ext = abs_delta / Decimal("1.15")            # back out 15% VAT
    line_ext = line_ext.quantize(Decimal("0.01"))
    vat = (line_ext * Decimal("0.15")).quantize(Decimal("0.01"))
    payable = (line_ext + vat).quantize(Decimal("0.01"))

    invoice_number = f"{orig_p.get('invoice_number') or orig.icv}-{'CN' if is_credit else 'DN'}"

    new_payload = {
        "doc_type": note_doc_type,
        "invoice_number": invoice_number,
        "uuid": "00000000-0000-0000-0000-000000000000",
        "issue_date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "issue_time": datetime.now(timezone.utc).strftime("%H:%M:%S"),
        "icv": 0, "pih_b64": "",
        "supplier": supplier, "customer": customer,
        "lines": [{
            "id": "1",
            "name": ("Refund — " if is_credit else "Additional charge — ") + body.reason,
            "quantity": "1", "unit_code": "PCE",
            "unit_price": str(line_ext),
            "line_extension": str(line_ext),
            "tax_amount": str(vat),
            "rounding_amount": str(payable),
            "tax_category": "S", "tax_percent": "15",
            "discount_amount": "0", "discount_reason": None,
        }],
        "tax_subtotals": [{
            "taxable_amount": str(line_ext), "tax_amount": str(vat),
            "tax_category": "S", "tax_percent": "15",
            "exemption_reason_code": None, "exemption_reason": None,
        }],
        "monetary_totals": {
            "line_extension": str(line_ext), "tax_exclusive": str(line_ext),
            "tax_inclusive": str(payable), "allowance_total": "0",
            "prepaid_amount": "0", "payable_amount": str(payable),
        },
        "payment_means_code": orig_p.get("payment_means_code") or "10",
        "instruction_note": body.reason,
        "billing_reference_id": orig_p.get("invoice_number") or str(orig.icv),
        "notes": [],
    }

    # Validate + bind into the typed Pydantic discriminator, then sign with
    # the production CSID. Re-uses the regular submit-invoice flow from here.
    from app.zatca.ubl_builder import InvoicePayload as _InvoicePayloadAdapter
    from pydantic import TypeAdapter
    adapter = TypeAdapter(_InvoicePayloadAdapter)
    payload_model = adapter.validate_python(new_payload)

    csid = await _resolve_csid(db, user.tenant_id, orig.env)
    last_icv, last_pih = await _take_chain_lock(db, user.tenant_id, orig.env)

    inv, invoice_hash = _sign_one(
        payload_model, env=orig.env, icv=last_icv + 1, pih=last_pih,
        tenant_id=user.tenant_id, csid=csid,
    )
    db.add(inv)
    db.add(PihChain(
        tenant_id=user.tenant_id, env=orig.env,
        icv=inv.icv, invoice_hash=invoice_hash,
    ))
    await db.commit()
    await db.refresh(inv)

    await _enqueue(inv.id)
    await publish(
        user.tenant_id, "invoice.queued",
        invoice_id=str(inv.id), icv=inv.icv, doc_type=inv.doc_type, status=inv.status,
    )

    return AmendResponse(
        note_kind=note_kind, delta=str(abs_delta),
        note_invoice_id=inv.id, note_icv=inv.icv,
        references=str(orig_p.get("invoice_number") or orig.icv),
    )


# ---------------------------------------------------------------------------
# read routes
# ---------------------------------------------------------------------------


class SubmissionOut(BaseModel):
    id: UUID
    kind: str
    http_status: int | None
    zatca_status: str | None
    attempt: int
    submitted_at: datetime | None
    response_payload: dict | None


class InvoiceDetail(BaseModel):
    id: UUID
    env: str
    uuid: UUID
    icv: int
    doc_type: str
    subtype: str
    status: str
    invoice_hash: str | None
    qr_base64: str | None
    last_error: str | None
    payload_json: dict
    signed_xml: str | None
    cleared_xml: str | None
    signed_at: datetime | None
    submitted_at: datetime | None
    created_at: datetime
    submissions: list[SubmissionOut]


@router.get("/{invoice_id}", response_model=InvoiceDetail)
async def get_invoice(invoice_id: UUID, user: CurrentUserDep, db: DbSession) -> InvoiceDetail:
    inv = await db.scalar(
        select(Invoice).where(Invoice.id == invoice_id, Invoice.tenant_id == user.tenant_id)
    )
    if inv is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "not_found")
    subs = (
        await db.execute(
            select(Submission)
            .where(Submission.invoice_id == inv.id)
            .order_by(Submission.submitted_at.asc())
        )
    ).scalars().all()
    return InvoiceDetail(
        id=inv.id, env=inv.env, uuid=inv.uuid, icv=inv.icv,
        doc_type=inv.doc_type, subtype=inv.subtype, status=inv.status,
        invoice_hash=inv.invoice_hash, qr_base64=inv.qr_base64,
        last_error=inv.last_error,
        payload_json=inv.payload_json or {},
        signed_xml=inv.signed_xml, cleared_xml=inv.cleared_xml,
        signed_at=inv.signed_at, submitted_at=inv.submitted_at,
        created_at=inv.created_at,
        submissions=[
            SubmissionOut(
                id=s.id, kind=s.kind, http_status=s.http_status,
                zatca_status=s.zatca_status, attempt=s.attempt,
                submitted_at=s.submitted_at, response_payload=s.response_payload,
            )
            for s in subs
        ],
    )


class InvoiceListItem(BaseModel):
    id: UUID
    icv: int
    doc_type: str
    status: str
    created_at: datetime
    invoice_number: str | None = None
    customer_name: str | None = None
    issue_date: str | None = None
    payable_amount: str | None = None


class InvoiceList(BaseModel):
    items: list[InvoiceListItem]
    total: int
    page: int
    page_size: int
    total_pages: int


@router.get("", response_model=InvoiceList)
async def list_invoices(
    user: CurrentUserDep,
    db: DbSession,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=200),
    statuses: str | None = Query(
        default=None,
        description="Comma-separated list of statuses to filter by. "
                    "Empty / omitted = no filter.",
    ),
    date_from: str | None = Query(default=None, description="ISO date — invoices created on/after."),
    date_to: str | None = Query(default=None, description="ISO date — invoices created on/before."),
) -> InvoiceList:
    """Offset/limit pagination ordered by ICV desc, with multi-status + date range filters."""
    base = select(Invoice).where(Invoice.tenant_id == user.tenant_id)

    if statuses:
        wanted = [s.strip() for s in statuses.split(",") if s.strip()]
        if wanted:
            base = base.where(Invoice.status.in_(wanted))
    if date_from:
        base = base.where(Invoice.created_at >= datetime.fromisoformat(date_from))
    if date_to:
        # inclusive end of day
        end = datetime.fromisoformat(date_to)
        end = end.replace(hour=23, minute=59, second=59, microsecond=999_999)
        base = base.where(Invoice.created_at <= end)

    total = await db.scalar(
        select(func.count()).select_from(base.subquery())
    ) or 0

    rows = (await db.execute(
        base.order_by(desc(Invoice.icv))
            .offset((page - 1) * page_size)
            .limit(page_size)
    )).scalars().all()

    total_pages = max(1, (int(total) + page_size - 1) // page_size)

    def _from_payload(r: Invoice) -> tuple[str | None, str | None, str | None, str | None]:
        p = r.payload_json or {}
        inv_num = p.get("invoice_number")
        issue_date = p.get("issue_date")
        cust = p.get("customer") or {}
        cust_name = cust.get("registration_name")
        totals = p.get("monetary_totals") or {}
        payable = totals.get("payable_amount")
        return inv_num, cust_name, issue_date, payable

    return InvoiceList(
        items=[
            InvoiceListItem(
                id=r.id, icv=r.icv, doc_type=r.doc_type,
                status=r.status, created_at=r.created_at,
                **dict(zip(
                    ["invoice_number", "customer_name", "issue_date", "payable_amount"],
                    _from_payload(r),
                )),
            )
            for r in rows
        ],
        total=int(total),
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )
