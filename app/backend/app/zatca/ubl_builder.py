"""JSON → UBL XML builder for ZATCA invoices.

Produces the *unsigned* UBL bytes consumed by ``sign.py``. We cover every invoice
class the SDK ships samples for:

  Simplified:  Invoice (388) / Credit Note (381) / Debit Note (383)
  Standard:    Invoice (388) / Credit Note (381) / Debit Note (383)
               + Export, Summary, Self-billing, Advance Payment,
                 Nominal Supply, Zero-rated, Exempt, Out-of-scope

The first cbc:InvoiceTypeCode element carries the UBL 1001 code as its body
(388/381/383) and a ZATCA-specific 7-digit transaction-type code in its ``name``
attribute (sample uses ``0200000`` for simplified, ``0100000`` for standard).
We model the discriminator on the Python side and translate to those codes at
serialize time.
"""
from __future__ import annotations

from datetime import date, time
from decimal import Decimal
from enum import Enum
from typing import Annotated, Literal, Union
from uuid import UUID

from lxml import etree
from pydantic import BaseModel, Field, model_validator

from app.zatca.canonicalize import NS


_NSMAP = {
    None: NS["ubl"],
    "cac": NS["cac"],
    "cbc": NS["cbc"],
    "ext": NS["ext"],
}


# ---------------------------------------------------------------------------
# Pydantic input model
# ---------------------------------------------------------------------------


class TaxCategoryCode(str, Enum):
    standard = "S"  # 15% VAT
    zero_rated = "Z"
    exempt = "E"
    out_of_scope = "O"
    export = "G"  # zero-rated export


class Party(BaseModel):
    registration_name: str
    vat_number: str | None = None
    crn: str | None = None  # commercial registration
    street: str
    building_number: str
    city_subdivision: str
    city: str
    postal_zone: str
    country_code: str = "SA"
    additional_id_scheme: str | None = None
    additional_id_value: str | None = None


class InvoiceLine(BaseModel):
    """Single line item.

    ``line_extension`` is the post-discount taxable amount of the line — i.e.
    ``quantity * unit_price - discount_amount + charge_amount``. The line's own
    ``tax_amount`` is computed on ``line_extension`` (not on the gross).

    Inline (price-level) discount/charge is emitted under ``<cac:Price>`` with
    ``<cbc:ChargeIndicator>`` = false for a discount (allowance) and true for a
    charge — UBL semantics. The SDK sample uses ``true`` for a zero-amount
    discount placeholder; for a real non-zero discount we follow the UBL rule.
    """

    id: str
    name: str
    quantity: Decimal
    unit_code: str = "PCE"
    unit_price: Decimal
    line_extension: Decimal
    tax_amount: Decimal
    rounding_amount: Decimal  # line_extension + tax_amount
    tax_category: TaxCategoryCode = TaxCategoryCode.standard
    tax_percent: Decimal = Decimal("15")
    discount_amount: Decimal = Decimal("0")
    discount_reason: str | None = None
    charge_amount: Decimal = Decimal("0")
    charge_reason: str | None = None


class DocumentAllowanceCharge(BaseModel):
    """Invoice (document) level allowance or charge.

    Emitted as ``<cac:AllowanceCharge>`` between ``<cac:PaymentMeans>`` and the
    headline ``<cac:TaxTotal>``. Reduces (allowance) or increases (charge) the
    taxable amount under the chosen tax category.
    """

    is_charge: bool = False
    reason: str
    reason_code: str | None = None  # UN/CEFACT 5189, e.g. "DISC", "LF"
    amount: Decimal
    tax_category: TaxCategoryCode = TaxCategoryCode.standard
    tax_percent: Decimal = Decimal("15")


class TaxSubtotal(BaseModel):
    taxable_amount: Decimal
    tax_amount: Decimal
    tax_category: TaxCategoryCode = TaxCategoryCode.standard
    tax_percent: Decimal = Decimal("15")
    exemption_reason_code: str | None = None
    exemption_reason: str | None = None


class MonetaryTotals(BaseModel):
    line_extension: Decimal
    tax_exclusive: Decimal
    tax_inclusive: Decimal
    allowance_total: Decimal = Decimal("0")
    charge_total: Decimal = Decimal("0")
    prepaid_amount: Decimal = Decimal("0")
    payable_amount: Decimal


class _InvoiceBase(BaseModel):
    """Common fields for every invoice flavor."""

    invoice_number: str = Field(min_length=1, max_length=200)
    uuid: UUID
    issue_date: date
    issue_time: time
    icv: int
    pih_b64: str
    currency: str = "SAR"
    tax_currency: str = "SAR"

    supplier: Party
    customer: Party

    lines: list[InvoiceLine]
    tax_subtotals: list[TaxSubtotal]
    monetary_totals: MonetaryTotals

    payment_means_code: str = "10"  # cash
    notes: list[tuple[str, str]] = Field(default_factory=list)  # (lang, text)
    instruction_note: str | None = None  # required for credit/debit
    billing_reference_id: str | None = None  # required for credit/debit
    document_charges: list[DocumentAllowanceCharge] = Field(default_factory=list)

    @model_validator(mode="after")
    def _require_billing_ref_for_notes(self) -> "_InvoiceBase":
        return self


class SimplifiedInvoice(_InvoiceBase):
    doc_type: Literal["simplified_invoice"] = "simplified_invoice"


class SimplifiedCreditNote(_InvoiceBase):
    doc_type: Literal["simplified_credit_note"] = "simplified_credit_note"


class SimplifiedDebitNote(_InvoiceBase):
    doc_type: Literal["simplified_debit_note"] = "simplified_debit_note"


class StandardInvoice(_InvoiceBase):
    doc_type: Literal["standard_invoice"] = "standard_invoice"


class StandardCreditNote(_InvoiceBase):
    doc_type: Literal["standard_credit_note"] = "standard_credit_note"


class StandardDebitNote(_InvoiceBase):
    doc_type: Literal["standard_debit_note"] = "standard_debit_note"


class ExportInvoice(_InvoiceBase):
    doc_type: Literal["export_invoice"] = "export_invoice"


class SummaryInvoice(_InvoiceBase):
    doc_type: Literal["summary_invoice"] = "summary_invoice"


class SelfBillingInvoice(_InvoiceBase):
    doc_type: Literal["self_billing_invoice"] = "self_billing_invoice"


class AdvancePaymentInvoice(_InvoiceBase):
    doc_type: Literal["advance_payment_invoice"] = "advance_payment_invoice"


class NominalSupplyInvoice(_InvoiceBase):
    doc_type: Literal["nominal_supply_invoice"] = "nominal_supply_invoice"


InvoicePayload = Annotated[
    Union[
        SimplifiedInvoice,
        SimplifiedCreditNote,
        SimplifiedDebitNote,
        StandardInvoice,
        StandardCreditNote,
        StandardDebitNote,
        ExportInvoice,
        SummaryInvoice,
        SelfBillingInvoice,
        AdvancePaymentInvoice,
        NominalSupplyInvoice,
    ],
    Field(discriminator="doc_type"),
]


# ---------------------------------------------------------------------------
# Type-code mapping
# ---------------------------------------------------------------------------


_BASE_CODE_BY_DOC = {
    "simplified_invoice": "388",
    "simplified_credit_note": "381",
    "simplified_debit_note": "383",
    "standard_invoice": "388",
    "standard_credit_note": "381",
    "standard_debit_note": "383",
    "export_invoice": "388",
    "summary_invoice": "388",
    "self_billing_invoice": "388",
    "advance_payment_invoice": "386",
    "nominal_supply_invoice": "388",
}


def _type_name_attribute(doc_type: str) -> str:
    """7-digit ZATCA transaction type code, the InvoiceTypeCode/@name value."""
    is_simplified = doc_type.startswith("simplified") or doc_type in {
        "nominal_supply_invoice",
        "advance_payment_invoice",
    }
    base = "02" if is_simplified else "01"
    third_party = "0"
    nominal = "1" if doc_type == "nominal_supply_invoice" else "0"
    export = "1" if doc_type == "export_invoice" else "0"
    summary = "1" if doc_type == "summary_invoice" else "0"
    self_billed = "1" if doc_type == "self_billing_invoice" else "0"
    return base + third_party + nominal + export + summary + self_billed


def _profile_id(doc_type: str) -> str:
    """ProfileID — ZATCA uses ``reporting:1.0`` for simplified, ``clearance:1.0`` for standard."""
    simplified_family = {
        "simplified_invoice",
        "simplified_credit_note",
        "simplified_debit_note",
        "nominal_supply_invoice",
        "advance_payment_invoice",
    }
    return "reporting:1.0" if doc_type in simplified_family else "clearance:1.0"


# ---------------------------------------------------------------------------
# XML builder helpers
# ---------------------------------------------------------------------------


def _cbc(_tag: str, _text: str | None = None, /, **attrs: str) -> etree._Element:
    """Build a <cbc:*> element. Tag and text are positional-only so that callers
    can use any XML attribute name (``name=`` included) via kwargs without
    colliding with the function's own parameter names.
    """
    el = etree.Element(f"{{{NS['cbc']}}}{_tag}")
    if _text is not None:
        el.text = _text
    for k, v in attrs.items():
        el.set(k, v)
    return el


def _cac(name: str) -> etree._Element:
    return etree.Element(f"{{{NS['cac']}}}{name}")


def _amount(name: str, value: Decimal, currency: str) -> etree._Element:
    return _cbc(name, f"{value:.2f}", currencyID=currency)


def _build_party_block(party: Party, *, supplier: bool) -> etree._Element:
    wrapper = _cac("AccountingSupplierParty" if supplier else "AccountingCustomerParty")
    party_el = _cac("Party")
    wrapper.append(party_el)

    if party.crn or party.additional_id_value:
        ident = _cac("PartyIdentification")
        scheme = party.additional_id_scheme or "CRN"
        value = party.additional_id_value or party.crn
        if value:
            id_el = _cbc("ID", value, schemeID=scheme)
            ident.append(id_el)
            party_el.append(ident)

    addr = _cac("PostalAddress")
    addr.append(_cbc("StreetName", party.street))
    addr.append(_cbc("BuildingNumber", party.building_number))
    addr.append(_cbc("CitySubdivisionName", party.city_subdivision))
    addr.append(_cbc("CityName", party.city))
    addr.append(_cbc("PostalZone", party.postal_zone))
    country = _cac("Country")
    country.append(_cbc("IdentificationCode", party.country_code))
    addr.append(country)
    party_el.append(addr)

    if party.vat_number:
        scheme = _cac("PartyTaxScheme")
        scheme.append(_cbc("CompanyID", party.vat_number))
        ts = _cac("TaxScheme")
        ts.append(_cbc("ID", "VAT"))
        scheme.append(ts)
        party_el.append(scheme)

    legal = _cac("PartyLegalEntity")
    legal.append(_cbc("RegistrationName", party.registration_name))
    party_el.append(legal)

    return wrapper


def _build_line(line: InvoiceLine, currency: str) -> etree._Element:
    el = _cac("InvoiceLine")
    el.append(_cbc("ID", line.id))
    el.append(_cbc("InvoicedQuantity", f"{line.quantity:.6f}", unitCode=line.unit_code))
    el.append(_amount("LineExtensionAmount", line.line_extension, currency))

    tax_total = _cac("TaxTotal")
    tax_total.append(_amount("TaxAmount", line.tax_amount, currency))
    tax_total.append(_amount("RoundingAmount", line.rounding_amount, currency))
    el.append(tax_total)

    item = _cac("Item")
    item.append(_cbc("Name", line.name))
    cat = _cac("ClassifiedTaxCategory")
    cat.append(_cbc("ID", line.tax_category.value))
    cat.append(_cbc("Percent", f"{line.tax_percent:.2f}"))
    cat_ts = _cac("TaxScheme")
    cat_ts.append(_cbc("ID", "VAT"))
    cat.append(cat_ts)
    item.append(cat)
    el.append(item)

    price = _cac("Price")
    price.append(_amount("PriceAmount", line.unit_price, currency))

    if line.discount_amount > 0 or line.discount_reason:
        ac = _cac("AllowanceCharge")
        ac.append(_cbc("ChargeIndicator", "false"))
        ac.append(_cbc("AllowanceChargeReason", line.discount_reason or "discount"))
        ac.append(_amount("Amount", line.discount_amount, currency))
        price.append(ac)
    if line.charge_amount > 0 or line.charge_reason:
        ac = _cac("AllowanceCharge")
        ac.append(_cbc("ChargeIndicator", "true"))
        ac.append(_cbc("AllowanceChargeReason", line.charge_reason or "charge"))
        ac.append(_amount("Amount", line.charge_amount, currency))
        price.append(ac)
    el.append(price)

    return el


def _build_document_allowance_charge(
    dc: DocumentAllowanceCharge, currency: str
) -> etree._Element:
    """Root-level AllowanceCharge (between PaymentMeans and TaxTotal)."""
    ac = _cac("AllowanceCharge")
    ac.append(_cbc("ChargeIndicator", "true" if dc.is_charge else "false"))
    if dc.reason_code:
        ac.append(_cbc("AllowanceChargeReasonCode", dc.reason_code))
    ac.append(_cbc("AllowanceChargeReason", dc.reason))
    ac.append(_amount("Amount", dc.amount, currency))
    cat = _cac("TaxCategory")
    cat.append(_cbc("ID", dc.tax_category.value, schemeID="UN/ECE 5305", schemeAgencyID="6"))
    cat.append(_cbc("Percent", f"{dc.tax_percent:.2f}"))
    ts = _cac("TaxScheme")
    ts.append(_cbc("ID", "VAT", schemeID="UN/ECE 5153", schemeAgencyID="6"))
    cat.append(ts)
    ac.append(cat)
    return ac


def build_unsigned_ubl(payload: _InvoiceBase) -> bytes:
    """Construct the unsigned UBL invoice — sign.py inserts UBLExtensions afterward."""
    root = etree.Element(f"{{{NS['ubl']}}}Invoice", nsmap=_NSMAP)

    root.append(_cbc("ProfileID", _profile_id(payload.doc_type)))
    root.append(_cbc("ID", payload.invoice_number))
    root.append(_cbc("UUID", str(payload.uuid)))
    root.append(_cbc("IssueDate", payload.issue_date.isoformat()))
    root.append(_cbc("IssueTime", payload.issue_time.strftime("%H:%M:%S")))

    type_code = _cbc(
        "InvoiceTypeCode",
        _BASE_CODE_BY_DOC[payload.doc_type],
        name=_type_name_attribute(payload.doc_type),
    )
    root.append(type_code)

    for lang, text in payload.notes:
        root.append(_cbc("Note", text, languageID=lang))

    root.append(_cbc("DocumentCurrencyCode", payload.currency))
    root.append(_cbc("TaxCurrencyCode", payload.tax_currency))

    if payload.billing_reference_id:
        br = _cac("BillingReference")
        idr = _cac("InvoiceDocumentReference")
        idr.append(_cbc("ID", payload.billing_reference_id))
        br.append(idr)
        root.append(br)

    icv_ref = _cac("AdditionalDocumentReference")
    icv_ref.append(_cbc("ID", "ICV"))
    icv_ref.append(_cbc("UUID", str(payload.icv)))
    root.append(icv_ref)

    pih_ref = _cac("AdditionalDocumentReference")
    pih_ref.append(_cbc("ID", "PIH"))
    pih_att = _cac("Attachment")
    pih_att.append(_cbc("EmbeddedDocumentBinaryObject", payload.pih_b64, mimeCode="text/plain"))
    pih_ref.append(pih_att)
    root.append(pih_ref)

    # QR placeholder — sign.py later removes UBLExtensions/Signature/QR from the
    # canonical bytes, then we inject the real QR after signing.
    qr_ref = _cac("AdditionalDocumentReference")
    qr_ref.append(_cbc("ID", "QR"))
    qr_att = _cac("Attachment")
    qr_att.append(_cbc("EmbeddedDocumentBinaryObject", "QR_PLACEHOLDER", mimeCode="text/plain"))
    qr_ref.append(qr_att)
    root.append(qr_ref)

    sig = _cac("Signature")
    sig.append(_cbc("ID", "urn:oasis:names:specification:ubl:signature:Invoice"))
    sig.append(_cbc("SignatureMethod", "urn:oasis:names:specification:ubl:dsig:enveloped:xades"))
    root.append(sig)

    root.append(_build_party_block(payload.supplier, supplier=True))
    root.append(_build_party_block(payload.customer, supplier=False))

    if payload.payment_means_code:
        pm = _cac("PaymentMeans")
        pm.append(_cbc("PaymentMeansCode", payload.payment_means_code))
        if payload.instruction_note:
            pm.append(_cbc("InstructionNote", payload.instruction_note))
        root.append(pm)

    for dc in payload.document_charges:
        root.append(_build_document_allowance_charge(dc, payload.currency))

    aggregate_tax = sum((s.tax_amount for s in payload.tax_subtotals), Decimal("0"))
    headline_tax = _cac("TaxTotal")
    headline_tax.append(_amount("TaxAmount", aggregate_tax, payload.currency))
    root.append(headline_tax)

    detail_tax = _cac("TaxTotal")
    detail_tax.append(_amount("TaxAmount", aggregate_tax, payload.currency))
    for st in payload.tax_subtotals:
        sub = _cac("TaxSubtotal")
        sub.append(_amount("TaxableAmount", st.taxable_amount, payload.currency))
        sub.append(_amount("TaxAmount", st.tax_amount, payload.currency))
        cat = _cac("TaxCategory")
        cat.append(_cbc("ID", st.tax_category.value, schemeID="UN/ECE 5305", schemeAgencyID="6"))
        cat.append(_cbc("Percent", f"{st.tax_percent:.2f}"))
        if st.exemption_reason_code:
            cat.append(_cbc("TaxExemptionReasonCode", st.exemption_reason_code))
        if st.exemption_reason:
            cat.append(_cbc("TaxExemptionReason", st.exemption_reason))
        ts = _cac("TaxScheme")
        ts.append(_cbc("ID", "VAT", schemeID="UN/ECE 5153", schemeAgencyID="6"))
        cat.append(ts)
        sub.append(cat)
        detail_tax.append(sub)
    root.append(detail_tax)

    monetary = _cac("LegalMonetaryTotal")
    mt = payload.monetary_totals
    monetary.append(_amount("LineExtensionAmount", mt.line_extension, payload.currency))
    monetary.append(_amount("TaxExclusiveAmount", mt.tax_exclusive, payload.currency))
    monetary.append(_amount("TaxInclusiveAmount", mt.tax_inclusive, payload.currency))
    monetary.append(_amount("AllowanceTotalAmount", mt.allowance_total, payload.currency))
    if mt.charge_total > 0:
        monetary.append(_amount("ChargeTotalAmount", mt.charge_total, payload.currency))
    monetary.append(_amount("PrepaidAmount", mt.prepaid_amount, payload.currency))
    monetary.append(_amount("PayableAmount", mt.payable_amount, payload.currency))
    root.append(monetary)

    for line in payload.lines:
        root.append(_build_line(line, payload.currency))

    return etree.tostring(root, xml_declaration=True, encoding="UTF-8")


def inject_qr(signed_xml: bytes, qr_b64: str) -> bytes:
    """Replace the QR_PLACEHOLDER with the real base64 QR. Called after sign + qr build."""
    root = etree.fromstring(signed_xml)
    for el in root.xpath(
        ".//cac:AdditionalDocumentReference[cbc:ID='QR']//cbc:EmbeddedDocumentBinaryObject",
        namespaces=NS,
    ):
        el.text = qr_b64
    return etree.tostring(root, xml_declaration=True, encoding="UTF-8")
