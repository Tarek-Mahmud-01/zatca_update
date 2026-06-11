"""Invoice issuance service — build UBL, sign, submit to ZATCA."""
from __future__ import annotations

import base64
from datetime import date, datetime, time, timezone
from decimal import ROUND_HALF_UP, Decimal
from uuid import UUID, uuid4

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from apps.invoices.models import Invoice, PihChain, Submission
from apps.invoices.schemas import InvoiceCreate, InvoiceLineSchema, PartySchema
from apps.onboarding.models import Csid
from apps.organizations.models import TenantOrganization
from apps.zatca.client import ZatcaClient
from apps.zatca.pipeline import ProcessedInvoice, _is_standard_doc, process_invoice, signed_xml_to_b64
from apps.zatca.ubl_builder import (
    AdvancePaymentInvoice,
    ExportInvoice,
    InvoiceLine,
    MonetaryTotals,
    NominalSupplyInvoice,
    Party,
    SelfBillingInvoice,
    SimplifiedCreditNote,
    SimplifiedDebitNote,
    SimplifiedInvoice,
    StandardCreditNote,
    StandardDebitNote,
    StandardInvoice,
    SummaryInvoice,
    TaxCategoryCode,
    TaxSubtotal,
    _InvoiceBase,
)

# ---- ZATCA genesis PIH (ICV=0 predecessor hash) ----------------------------
GENESIS_PIH = "NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ=="

# ---- doc_type → UBL class mapping ------------------------------------------
DOC_CLASS: dict[str, type[_InvoiceBase]] = {
    "standard_invoice": StandardInvoice,
    "standard_credit_note": StandardCreditNote,
    "standard_debit_note": StandardDebitNote,
    "simplified_invoice": SimplifiedInvoice,
    "simplified_credit_note": SimplifiedCreditNote,
    "simplified_debit_note": SimplifiedDebitNote,
    "export_invoice": ExportInvoice,
    "summary_invoice": SummaryInvoice,
    "self_billing_invoice": SelfBillingInvoice,
    "advance_payment_invoice": AdvancePaymentInvoice,
    "nominal_supply_invoice": NominalSupplyInvoice,
}

# Derive subtype from doc_type for the Invoice.subtype column.
_SUBTYPE_MAP: dict[str, str] = {
    "standard_invoice": "0100000",
    "standard_credit_note": "0100000",
    "standard_debit_note": "0100000",
    "simplified_invoice": "0200000",
    "simplified_credit_note": "0200000",
    "simplified_debit_note": "0200000",
    "export_invoice": "0100010",
    "summary_invoice": "0100001",
    "self_billing_invoice": "0100000",
    "advance_payment_invoice": "0200000",
    "nominal_supply_invoice": "0201000",
}


def _org_to_party(org: TenantOrganization | None) -> Party:
    """Convert a TenantOrganization row (or None) to a UBL Party."""
    if org is None:
        return Party(
            registration_name="Demo Supplier",
            vat_number="300000000000003",
            street="King Fahd Road",
            building_number="1000",
            city_subdivision="Al Olaya",
            city="Riyadh",
            postal_zone="12244",
            country_code="SA",
        )
    return Party(
        registration_name=org.trade_name or org.name,
        vat_number=org.vat_number,
        crn=org.registration_number,
        street=org.street or "",
        building_number=org.building_number or "",
        city_subdivision=org.city_subdivision or "",
        city=org.city or "Riyadh",
        postal_zone=org.postal_zone or "00000",
        country_code=org.country_code,
    )


def _schema_to_party(s: PartySchema) -> Party:
    return Party(
        registration_name=s.registration_name,
        vat_number=s.vat_number,
        crn=s.crn,
        street=s.street,
        building_number=s.building_number,
        city_subdivision=s.city_subdivision,
        city=s.city,
        postal_zone=s.postal_zone,
        country_code=s.country_code,
    )


def _two(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


class InvoiceService:
    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    # -------------------------------------------------------------------------
    # Helpers
    # -------------------------------------------------------------------------

    def _compute_totals(
        self, lines: list[InvoiceLineSchema]
    ) -> tuple[Decimal, Decimal, Decimal]:
        """Return (line_extension_total, tax_total, total_with_vat)."""
        line_ext_total = Decimal("0")
        tax_total = Decimal("0")

        for ln in lines:
            net = _two(ln.unit_price * ln.quantity * (1 - ln.discount_percent / 100))
            vat = _two(net * ln.tax_percent / 100)
            line_ext_total += net
            tax_total += vat

        line_ext_total = _two(line_ext_total)
        tax_total = _two(tax_total)
        total_with_vat = _two(line_ext_total + tax_total)
        return line_ext_total, tax_total, total_with_vat

    def _build_ubl_lines(
        self, lines: list[InvoiceLineSchema]
    ) -> list[InvoiceLine]:
        ubl_lines: list[InvoiceLine] = []
        for ln in lines:
            net = _two(ln.unit_price * ln.quantity * (1 - ln.discount_percent / 100))
            vat = _two(net * ln.tax_percent / 100)
            rounding = _two(net + vat)
            discount_amount = _two(ln.unit_price * ln.quantity * (ln.discount_percent / 100))
            try:
                tax_cat = TaxCategoryCode(ln.tax_category)
            except ValueError:
                tax_cat = TaxCategoryCode.standard
            ubl_lines.append(
                InvoiceLine(
                    id=ln.id,
                    name=ln.name,
                    quantity=ln.quantity,
                    unit_code=ln.unit_code,
                    unit_price=ln.unit_price,
                    line_extension=net,
                    tax_amount=vat,
                    rounding_amount=rounding,
                    tax_category=tax_cat,
                    tax_percent=ln.tax_percent,
                    discount_amount=discount_amount,
                )
            )
        return ubl_lines

    def _build_ubl_payload(
        self,
        invoice_data: InvoiceCreate,
        supplier_party: Party,
        icv: int,
        prev_pih: str,
    ) -> _InvoiceBase:
        doc_type = invoice_data.doc_type
        cls = DOC_CLASS.get(doc_type)
        if cls is None:
            raise ValueError(f"Unknown doc_type: {doc_type!r}")

        line_ext_total, tax_total, total_with_vat = self._compute_totals(invoice_data.lines)
        ubl_lines = self._build_ubl_lines(invoice_data.lines)

        customer_party = _schema_to_party(invoice_data.customer)
        issue_date = invoice_data.issue_date or date.today()
        invoice_uuid = uuid4()

        # Aggregate tax subtotals by (category, percent).
        subtotal_map: dict[tuple[str, Decimal], Decimal] = {}
        for ln in invoice_data.lines:
            key = (ln.tax_category, ln.tax_percent)
            net = _two(ln.unit_price * ln.quantity * (1 - ln.discount_percent / 100))
            vat = _two(net * ln.tax_percent / 100)
            subtotal_map[key] = subtotal_map.get(key, Decimal("0")) + net
            # Track taxable per category; store as (taxable, tax)
        tax_subtotals_map: dict[tuple[str, Decimal], list[Decimal]] = {}
        for ln in invoice_data.lines:
            key = (ln.tax_category, ln.tax_percent)
            net = _two(ln.unit_price * ln.quantity * (1 - ln.discount_percent / 100))
            vat = _two(net * ln.tax_percent / 100)
            if key not in tax_subtotals_map:
                tax_subtotals_map[key] = [Decimal("0"), Decimal("0")]
            tax_subtotals_map[key][0] += net
            tax_subtotals_map[key][1] += vat

        tax_subtotals: list[TaxSubtotal] = []
        for (cat_str, pct), (taxable, vat) in tax_subtotals_map.items():
            try:
                cat = TaxCategoryCode(cat_str)
            except ValueError:
                cat = TaxCategoryCode.standard
            tax_subtotals.append(
                TaxSubtotal(
                    taxable_amount=_two(taxable),
                    tax_amount=_two(vat),
                    tax_category=cat,
                    tax_percent=pct,
                )
            )

        monetary_totals = MonetaryTotals(
            line_extension=line_ext_total,
            tax_exclusive=line_ext_total,
            tax_inclusive=total_with_vat,
            payable_amount=total_with_vat,
        )

        # Build notes as list of (lang, text) tuples.
        notes_tuples = [("ar", n) for n in invoice_data.notes]

        # Invoice number: ICV-based sequential identifier.
        invoice_number = str(icv)

        payload = cls(
            invoice_number=invoice_number,
            uuid=invoice_uuid,
            issue_date=issue_date,
            issue_time=datetime.now(timezone.utc).time().replace(microsecond=0),
            icv=icv,
            pih_b64=prev_pih,
            supplier=supplier_party,
            customer=customer_party,
            lines=ubl_lines,
            tax_subtotals=tax_subtotals,
            monetary_totals=monetary_totals,
            payment_means_code=invoice_data.payment_means_code,
            notes=notes_tuples,
            billing_reference_id=invoice_data.billing_reference_id,
            instruction_note=invoice_data.instruction_note,
            instruction_code=invoice_data.instruction_code,
        )
        return payload

    # -------------------------------------------------------------------------
    # Public methods
    # -------------------------------------------------------------------------

    async def create_and_sign(
        self,
        tenant_id: UUID,
        data: InvoiceCreate,
    ) -> Invoice:
        db = self._db

        # 1. Resolve CSID.
        kind = "ccsid" if data.use_compliance_csid else "pcsid"
        result = await db.execute(
            select(Csid).where(
                Csid.tenant_id == tenant_id,
                Csid.env == data.env,
                Csid.kind == kind,
            )
        )
        csid = result.scalar_one_or_none()
        if csid is None:
            # Fall back: if pcsid not found and we haven't already tried ccsid.
            if kind == "pcsid":
                result2 = await db.execute(
                    select(Csid).where(
                        Csid.tenant_id == tenant_id,
                        Csid.env == data.env,
                        Csid.kind == "ccsid",
                    )
                )
                csid = result2.scalar_one_or_none()
            if csid is None:
                raise ValueError(f"No {kind} CSID found for env={data.env!r}")

        # 2. Acquire advisory lock + determine ICV + prev PIH (inside a transaction).
        lock_key = abs(hash(str(tenant_id))) % (2**31)
        await db.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": lock_key})

        max_icv_row = await db.execute(
            select(func.max(PihChain.icv)).where(
                PihChain.tenant_id == tenant_id,
                PihChain.env == data.env,
            )
        )
        max_icv: int = max_icv_row.scalar() or 0
        icv = max_icv + 1

        if max_icv == 0:
            prev_pih = GENESIS_PIH
        else:
            prev_row_result = await db.execute(
                select(PihChain).where(
                    PihChain.tenant_id == tenant_id,
                    PihChain.env == data.env,
                    PihChain.icv == max_icv,
                )
            )
            prev_row = prev_row_result.scalar_one()
            prev_pih = prev_row.invoice_hash

        # 3. Get supplier party from tenant's default organization.
        org_result = await db.execute(
            select(TenantOrganization).where(
                TenantOrganization.tenant_id == tenant_id,
                TenantOrganization.is_default == True,  # noqa: E712
            )
        )
        org = org_result.scalar_one_or_none()
        supplier_party = _org_to_party(org)

        # 4. Build UBL payload.
        payload = self._build_ubl_payload(data, supplier_party, icv, prev_pih)

        # 5. Sign invoice.
        processed: ProcessedInvoice = process_invoice(
            payload,
            private_key_pem=csid.private_key_pem,
            certificate_pem=csid.certificate_pem,
        )

        # 6. Persist Invoice row.
        signed_xml_str = processed.signed_xml.decode("utf-8")
        subtype = _SUBTYPE_MAP.get(data.doc_type, "0100000")
        now = datetime.now(timezone.utc)

        invoice = Invoice(
            tenant_id=tenant_id,
            env=data.env,
            uuid=payload.uuid,
            icv=icv,
            doc_type=data.doc_type,
            subtype=subtype,
            payload_json=data.model_dump(mode="json"),
            signed_xml=signed_xml_str,
            invoice_hash=processed.invoice_hash_b64,
            qr_base64=processed.qr_b64,
            status="signed",
            signed_at=now,
        )
        db.add(invoice)
        await db.flush()  # get invoice.id

        # 7. Persist PihChain row.
        pih_row = PihChain(
            tenant_id=tenant_id,
            env=data.env,
            icv=icv,
            invoice_hash=processed.invoice_hash_b64,
        )
        db.add(pih_row)

        # 8. Commit.
        await db.commit()
        await db.refresh(invoice)
        return invoice

    async def submit_to_zatca(
        self,
        invoice_id: UUID,
        tenant_id: UUID,
        use_compliance_csid: bool = False,
    ) -> Invoice:
        db = self._db

        # 1. Load invoice.
        invoice = await db.get(Invoice, invoice_id)
        if invoice is None or invoice.tenant_id != tenant_id:
            raise ValueError(f"Invoice {invoice_id} not found")

        if invoice.signed_xml is None or invoice.invoice_hash is None:
            raise ValueError("Invoice has not been signed yet")

        # 2. Resolve CSID (prefer pcsid).
        csid_result = await db.execute(
            select(Csid).where(
                Csid.tenant_id == tenant_id,
                Csid.env == invoice.env,
                Csid.kind == "pcsid",
            )
        )
        csid = csid_result.scalar_one_or_none()
        if csid is None:
            csid_result2 = await db.execute(
                select(Csid).where(
                    Csid.tenant_id == tenant_id,
                    Csid.env == invoice.env,
                    Csid.kind == "ccsid",
                )
            )
            csid = csid_result2.scalar_one_or_none()
        if csid is None:
            raise ValueError(f"No CSID found for env={invoice.env!r}")
        if csid.binary_security_token is None or csid.secret is None:
            raise ValueError("CSID is not fully provisioned (missing token/secret)")

        # 3. Determine submission kind.
        is_standard = _is_standard_doc(invoice.doc_type)
        is_compliance = csid.kind == "ccsid"
        kind = "compliance" if is_compliance else ("clearance" if is_standard else "reporting")

        # 4. Encode signed XML as base64.
        invoice_b64 = base64.b64encode(invoice.signed_xml.encode("utf-8")).decode()

        # 5. Submit to ZATCA.
        client = ZatcaClient(invoice.env)  # type: ignore[arg-type]
        request_payload = {
            "invoiceHash": invoice.invoice_hash,
            "uuid": str(invoice.uuid),
            "invoice": invoice_b64,
        }
        try:
            if is_compliance:
                response = await client.submit_compliance_invoice(
                    binary_security_token=csid.binary_security_token,
                    secret=csid.secret,
                    invoice_b64=invoice_b64,
                    invoice_hash=invoice.invoice_hash,
                    uuid=str(invoice.uuid),
                )
            elif is_standard:
                response = await client.submit_clearance(
                    binary_security_token=csid.binary_security_token,
                    secret=csid.secret,
                    invoice_b64=invoice_b64,
                    invoice_hash=invoice.invoice_hash,
                    uuid=str(invoice.uuid),
                )
            else:
                response = await client.submit_reporting(
                    binary_security_token=csid.binary_security_token,
                    secret=csid.secret,
                    invoice_b64=invoice_b64,
                    invoice_hash=invoice.invoice_hash,
                    uuid=str(invoice.uuid),
                )
        except Exception as exc:
            invoice.status = "failed"
            invoice.last_error = str(exc)
            await db.commit()
            await db.refresh(invoice)
            return invoice

        # 6. Parse ZATCA response status.
        body = response.body
        zatca_status: str | None = (
            body.get("clearanceStatus") or body.get("reportingStatus")
        )
        now = datetime.now(timezone.utc)

        if response.status_code in (200, 202):
            if zatca_status and zatca_status.upper() in ("CLEARED", "REPORTED"):
                new_status = zatca_status.lower()
            else:
                new_status = "submitted"
            invoice.status = new_status
            invoice.submitted_at = now
            # Store cleared XML if returned.
            cleared = body.get("clearedInvoice")
            if cleared:
                try:
                    invoice.cleared_xml = base64.b64decode(cleared).decode("utf-8")
                except Exception:
                    invoice.cleared_xml = cleared
        else:
            new_status = "failed"
            invoice.status = "failed"
            invoice.last_error = response.raw_text[:2000]

        # 7. Count previous submission attempts.
        attempt_result = await db.execute(
            select(func.count()).where(Submission.invoice_id == invoice.id)
        )
        attempt_count: int = attempt_result.scalar() or 0

        # 8. Create Submission row.
        submission = Submission(
            invoice_id=invoice.id,
            env=invoice.env,
            kind=kind,
            request_payload=request_payload,
            response_payload=body,
            http_status=response.status_code,
            zatca_status=zatca_status,
            attempt=attempt_count + 1,
            submitted_at=now,
        )
        db.add(submission)

        await db.commit()
        await db.refresh(invoice)
        return invoice
