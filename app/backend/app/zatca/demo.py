"""Demo invoice payloads for ZATCA compliance checks.

The 4-digit ``invoice_type`` on the CSR is a bitmask:

    position 1  Standard tax invoice    (1 = enabled)  -> B2B  (clearance)
    position 2  Simplified tax invoice  (1 = enabled)  -> B2C  (reporting)
    position 3-4  reserved (0)

  1100  -> Standard + Simplified  -> 6 B2B + 3 B2C = 9 demo invoices
  1000  -> Standard only          -> 6 B2B
  0100  -> Simplified only        -> 3 B2C

ZATCA's compliance environment accepts more than the minimum 3-per-family. We
ship an expanded **6-invoice B2B set** that exercises the four pricing primitives
a real merchant will hit on day one:

  1.  Basic standard invoice        — straight 100 SAR + 15% VAT
  2.  Inline (line-level) discount  — discount inside <cac:Price><cac:AllowanceCharge>
  3.  Document-level discount       — <cac:AllowanceCharge> between PaymentMeans/TaxTotal
  4.  Mixed VAT categories          — Standard (S 15%) + Zero-rated (Z 0%) on one invoice
  5.  Credit note                   — partial refund referencing #1
  6.  Debit note                    — additional charge referencing #1

If only the simplified bit is set, we still ship the original 3-invoice B2C
set (Invoice, CN, DN) since B2C reporting is structurally simpler — the demo
mirrors what a retail tenant actually sends.
"""
from __future__ import annotations

from datetime import date, datetime, time, timezone
from decimal import Decimal
from typing import Literal
from uuid import uuid4

from app.db.models import CsrConfig, Tenant
from app.zatca.ubl_builder import (
    DocumentAllowanceCharge,
    InvoiceLine,
    MonetaryTotals,
    Party,
    SimplifiedCreditNote,
    SimplifiedDebitNote,
    SimplifiedInvoice,
    StandardCreditNote,
    StandardDebitNote,
    StandardInvoice,
    TaxCategoryCode,
    TaxSubtotal,
    _InvoiceBase,
)

DemoKind = Literal[
    "standard_invoice", "standard_credit_note", "standard_debit_note",
    "simplified_invoice", "simplified_credit_note", "simplified_debit_note",
]


# ---------------------------------------------------------------------------
# bitmask -> demo lineup
# ---------------------------------------------------------------------------


def _b2b_lineup() -> list[tuple[str, DemoKind]]:
    """The 6 B2B scenarios in the order they are submitted."""
    return [
        ("basic",            "standard_invoice"),
        ("line_discount",    "standard_invoice"),
        ("doc_discount",     "standard_invoice"),
        ("mixed_vat",        "standard_invoice"),
        ("credit_note",      "standard_credit_note"),
        ("debit_note",       "standard_debit_note"),
    ]


def _b2c_lineup() -> list[tuple[str, DemoKind]]:
    """The 6 B2C / simplified scenarios in the order they are submitted.

    Mirrors the B2B set but tuned to retail patterns (walk-in customer, no VAT
    number on the buyer, multi-item baskets, food zero-rating).
    """
    return [
        ("basic",            "simplified_invoice"),
        ("line_discount",    "simplified_invoice"),
        ("multi_line_basket", "simplified_invoice"),
        ("mixed_vat",        "simplified_invoice"),
        ("credit_note",      "simplified_credit_note"),
        ("debit_note",       "simplified_debit_note"),
    ]


def scenarios_for_invoice_type(invoice_type: str) -> list[tuple[str, DemoKind]]:
    """Return the ordered (scenario, doc_type) list dictated by the bitmask."""
    if len(invoice_type) != 4 or not all(c in "01" for c in invoice_type):
        raise ValueError(f"invalid invoice_type bitmask: {invoice_type!r}")

    standard_enabled = invoice_type[0] == "1"
    simplified_enabled = invoice_type[1] == "1"
    if not (standard_enabled or simplified_enabled):
        raise ValueError("invoice_type must enable at least Standard or Simplified")

    out: list[tuple[str, DemoKind]] = []
    if standard_enabled:
        out.extend(_b2b_lineup())
    if simplified_enabled:
        out.extend(_b2c_lineup())
    return out


# Back-compat: callers that just want the doc-type list
def doc_types_for_invoice_type(invoice_type: str) -> list[str]:
    return [doc for _scenario, doc in scenarios_for_invoice_type(invoice_type)]


# ---------------------------------------------------------------------------
# party helpers
# ---------------------------------------------------------------------------


def _supplier_from_csr(cfg: CsrConfig, tenant: Tenant) -> Party:
    return Party(
        registration_name=cfg.organization_name,
        vat_number=tenant.vat_number,
        crn=tenant.organization_identifier,
        street=(cfg.location_address or "Street")[:140],
        building_number="0001",
        city_subdivision="District",
        city="Riyadh",
        postal_zone="00000",
        country_code=cfg.country_name or "SA",
    )


def _b2b_customer() -> Party:
    return Party(
        registration_name="Compliance Test Buyer LTD",
        vat_number="399999999800003",
        street="Salah Al-Din",
        building_number="1111",
        city_subdivision="Al-Murooj",
        city="Riyadh",
        postal_zone="12222",
        country_code="SA",
    )


def _b2c_customer() -> Party:
    return Party(
        registration_name="Walk-in Customer",
        street="Walk-in",
        building_number="0",
        city_subdivision="N/A",
        city="Riyadh",
        postal_zone="00000",
        country_code="SA",
    )


# ---------------------------------------------------------------------------
# Money math helpers — keep totals exact so ZATCA validators don't complain.
# Every helper below returns *consistent* line + subtotal + monetary numbers
# for the scenario it models.
# ---------------------------------------------------------------------------


def _q(value: Decimal | int | float | str) -> Decimal:
    """Quantize to 2 dp using banker's rounding off (ROUND_HALF_UP works here)."""
    from decimal import ROUND_HALF_UP
    return Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _now_time() -> time:
    n = datetime.now(timezone.utc)
    return time(n.hour, n.minute, n.second)


# ---- 1. basic invoice ----------------------------------------------------


def _basic(supplier: Party, customer: Party, number: str) -> dict:
    line = InvoiceLine(
        id="1",
        name="Consulting services",
        quantity=Decimal("1"),
        unit_code="PCE",
        unit_price=Decimal("100.00"),
        line_extension=Decimal("100.00"),
        tax_amount=Decimal("15.00"),
        rounding_amount=Decimal("115.00"),
        tax_percent=Decimal("15"),
    )
    subtotal = TaxSubtotal(taxable_amount=_q(100), tax_amount=_q(15))
    totals = MonetaryTotals(
        line_extension=_q(100),
        tax_exclusive=_q(100),
        tax_inclusive=_q(115),
        payable_amount=_q(115),
    )
    return _kw(supplier, customer, number, [line], [subtotal], totals)


# ---- 2. inline (line-level) discount ------------------------------------


def _line_discount(supplier: Party, customer: Party, number: str) -> dict:
    """10 × 100 SAR with 100 SAR price-level discount + a clean second line."""
    line1 = InvoiceLine(
        id="1",
        name="Bulk consulting hours",
        quantity=Decimal("10"),
        unit_code="HUR",
        unit_price=Decimal("100.00"),
        line_extension=Decimal("900.00"),   # 10*100 - 100 discount
        tax_amount=Decimal("135.00"),       # 900 * 15%
        rounding_amount=Decimal("1035.00"),
        tax_percent=Decimal("15"),
        discount_amount=Decimal("100.00"),
        discount_reason="Bulk-hour discount",
    )
    line2 = InvoiceLine(
        id="2",
        name="Setup fee",
        quantity=Decimal("1"),
        unit_code="PCE",
        unit_price=Decimal("200.00"),
        line_extension=Decimal("200.00"),
        tax_amount=Decimal("30.00"),
        rounding_amount=Decimal("230.00"),
        tax_percent=Decimal("15"),
    )
    subtotal = TaxSubtotal(taxable_amount=_q(1100), tax_amount=_q(165))
    totals = MonetaryTotals(
        line_extension=_q(1100),
        tax_exclusive=_q(1100),
        tax_inclusive=_q(1265),
        payable_amount=_q(1265),
    )
    return _kw(supplier, customer, number, [line1, line2], [subtotal], totals)


# ---- 3. document (invoice) level discount -------------------------------


def _doc_discount(supplier: Party, customer: Party, number: str) -> dict:
    """1 × 1000 SAR with 100 SAR document-level discount.

    Math:
       line ext            = 1000
       doc allowance       =  100
       tax exclusive       =  900   (line - allowance)
       tax @ 15% on 900    =  135
       payable             = 1035

    The line itself reports its own 150 of tax (on 1000); the headline TaxTotal
    is computed on 900 — both views are valid per ZATCA and consistent with the
    SDK's "Standard Invoice with Document Level Charge" sample.
    """
    line = InvoiceLine(
        id="1",
        name="Annual support contract",
        quantity=Decimal("1"),
        unit_code="PCE",
        unit_price=Decimal("1000.00"),
        line_extension=Decimal("1000.00"),
        tax_amount=Decimal("150.00"),
        rounding_amount=Decimal("1150.00"),
        tax_percent=Decimal("15"),
    )
    doc_allowance = DocumentAllowanceCharge(
        is_charge=False,
        reason="Promotional invoice discount",
        reason_code="95",  # Discount (UN/CEFACT 5189)
        amount=Decimal("100.00"),
        tax_percent=Decimal("15"),
    )
    subtotal = TaxSubtotal(taxable_amount=_q(900), tax_amount=_q(135))
    totals = MonetaryTotals(
        line_extension=_q(1000),
        allowance_total=_q(100),
        tax_exclusive=_q(900),
        tax_inclusive=_q(1035),
        payable_amount=_q(1035),
    )
    kw = _kw(supplier, customer, number, [line], [subtotal], totals)
    kw["document_charges"] = [doc_allowance]
    return kw


# ---- B2C variant: multi-line basket -------------------------------------


def _multi_line_basket(supplier: Party, customer: Party, number: str) -> dict:
    """Typical 3-item retail basket — every line under standard 15%.

    Item A: 2 × 25.00 SAR = 50.00 + 7.50 VAT
    Item B: 1 × 75.00 SAR = 75.00 + 11.25 VAT
    Item C: 3 × 10.00 SAR = 30.00 + 4.50 VAT
    Totals: 155.00 line_ext + 23.25 VAT = 178.25 payable
    """
    line_a = InvoiceLine(
        id="1", name="Coffee 250g",
        quantity=Decimal("2"), unit_code="PCE",
        unit_price=Decimal("25.00"),
        line_extension=Decimal("50.00"),
        tax_amount=Decimal("7.50"),
        rounding_amount=Decimal("57.50"),
        tax_percent=Decimal("15"),
    )
    line_b = InvoiceLine(
        id="2", name="Headphones",
        quantity=Decimal("1"), unit_code="PCE",
        unit_price=Decimal("75.00"),
        line_extension=Decimal("75.00"),
        tax_amount=Decimal("11.25"),
        rounding_amount=Decimal("86.25"),
        tax_percent=Decimal("15"),
    )
    line_c = InvoiceLine(
        id="3", name="Notebook",
        quantity=Decimal("3"), unit_code="PCE",
        unit_price=Decimal("10.00"),
        line_extension=Decimal("30.00"),
        tax_amount=Decimal("4.50"),
        rounding_amount=Decimal("34.50"),
        tax_percent=Decimal("15"),
    )
    subtotal = TaxSubtotal(taxable_amount=_q(155), tax_amount=_q("23.25"))
    totals = MonetaryTotals(
        line_extension=_q(155),
        tax_exclusive=_q(155),
        tax_inclusive=_q("178.25"),
        payable_amount=_q("178.25"),
    )
    return _kw(supplier, customer, number, [line_a, line_b, line_c], [subtotal], totals)


# ---- 4. mixed VAT (standard + zero-rated) -------------------------------


def _mixed_vat(supplier: Party, customer: Party, number: str) -> dict:
    """Two lines under different tax categories.

       Line 1: Standard rated  S 15%   500 SAR taxable -> 75 VAT
       Line 2: Zero rated      Z 0%    500 SAR taxable ->  0 VAT
       Totals: 1000 line ext, 75 VAT, 1075 payable
    """
    line1 = InvoiceLine(
        id="1",
        name="Software license",
        quantity=Decimal("1"),
        unit_code="PCE",
        unit_price=Decimal("500.00"),
        line_extension=Decimal("500.00"),
        tax_amount=Decimal("75.00"),
        rounding_amount=Decimal("575.00"),
        tax_category=TaxCategoryCode.standard,
        tax_percent=Decimal("15"),
    )
    line2 = InvoiceLine(
        id="2",
        name="Export-only training (zero rated)",
        quantity=Decimal("1"),
        unit_code="PCE",
        unit_price=Decimal("500.00"),
        line_extension=Decimal("500.00"),
        tax_amount=Decimal("0.00"),
        rounding_amount=Decimal("500.00"),
        tax_category=TaxCategoryCode.zero_rated,
        tax_percent=Decimal("0"),
    )
    subtotal_s = TaxSubtotal(
        taxable_amount=_q(500), tax_amount=_q(75),
        tax_category=TaxCategoryCode.standard, tax_percent=Decimal("15"),
    )
    subtotal_z = TaxSubtotal(
        taxable_amount=_q(500), tax_amount=_q(0),
        tax_category=TaxCategoryCode.zero_rated, tax_percent=Decimal("0"),
        exemption_reason_code="VATEX-SA-32",
        exemption_reason="Export of services",
    )
    totals = MonetaryTotals(
        line_extension=_q(1000),
        tax_exclusive=_q(1000),
        tax_inclusive=_q(1075),
        payable_amount=_q(1075),
    )
    return _kw(supplier, customer, number, [line1, line2], [subtotal_s, subtotal_z], totals)


# ---- 5. credit note (references basic invoice) --------------------------


def _credit_note(supplier: Party, customer: Party, number: str, original: str) -> dict:
    """Partial refund of 50 SAR + 7.50 VAT against the basic invoice."""
    line = InvoiceLine(
        id="1",
        name="Refund — consulting services (partial)",
        quantity=Decimal("1"),
        unit_code="PCE",
        unit_price=Decimal("50.00"),
        line_extension=Decimal("50.00"),
        tax_amount=Decimal("7.50"),
        rounding_amount=Decimal("57.50"),
        tax_percent=Decimal("15"),
    )
    subtotal = TaxSubtotal(taxable_amount=_q(50), tax_amount=_q("7.50"))
    totals = MonetaryTotals(
        line_extension=_q(50),
        tax_exclusive=_q(50),
        tax_inclusive=_q("57.50"),
        payable_amount=_q("57.50"),
    )
    kw = _kw(supplier, customer, number, [line], [subtotal], totals)
    kw["billing_reference_id"] = original
    kw["instruction_note"] = f"Partial refund against {original}"
    return kw


# ---- 6. debit note (references basic invoice) ---------------------------


def _debit_note(supplier: Party, customer: Party, number: str, original: str) -> dict:
    """Additional charge of 30 SAR + 4.50 VAT against the basic invoice."""
    line = InvoiceLine(
        id="1",
        name="Late payment fee",
        quantity=Decimal("1"),
        unit_code="PCE",
        unit_price=Decimal("30.00"),
        line_extension=Decimal("30.00"),
        tax_amount=Decimal("4.50"),
        rounding_amount=Decimal("34.50"),
        tax_percent=Decimal("15"),
    )
    subtotal = TaxSubtotal(taxable_amount=_q(30), tax_amount=_q("4.50"))
    totals = MonetaryTotals(
        line_extension=_q(30),
        tax_exclusive=_q(30),
        tax_inclusive=_q("34.50"),
        payable_amount=_q("34.50"),
    )
    kw = _kw(supplier, customer, number, [line], [subtotal], totals)
    kw["billing_reference_id"] = original
    kw["instruction_note"] = f"Additional charge on {original}"
    return kw


# ---------------------------------------------------------------------------
# common kwargs assembly
# ---------------------------------------------------------------------------


def _kw(
    supplier: Party, customer: Party, number: str,
    lines: list[InvoiceLine], subtotals: list[TaxSubtotal], totals: MonetaryTotals,
) -> dict:
    return dict(
        invoice_number=number,
        uuid=uuid4(),
        issue_date=date.today(),
        issue_time=_now_time(),
        icv=0,
        pih_b64="",
        supplier=supplier,
        customer=customer,
        lines=lines,
        tax_subtotals=subtotals,
        monetary_totals=totals,
        payment_means_code="10",
        notes=[],
    )


# ---------------------------------------------------------------------------
# top-level builder
# ---------------------------------------------------------------------------


_DOC_TYPE_TO_CLASS = {
    "standard_invoice":       StandardInvoice,
    "standard_credit_note":   StandardCreditNote,
    "standard_debit_note":    StandardDebitNote,
    "simplified_invoice":     SimplifiedInvoice,
    "simplified_credit_note": SimplifiedCreditNote,
    "simplified_debit_note":  SimplifiedDebitNote,
}


def _build_one(
    scenario: str, doc_type: DemoKind, supplier: Party, b2c: bool, seq: int, basic_ref: str,
) -> _InvoiceBase:
    base_prefix = "DEMO-SIM" if b2c else "DEMO-STD"
    number = f"{base_prefix}-{seq:03d}"
    customer = _b2c_customer() if b2c else _b2b_customer()

    if scenario == "basic":
        kw = _basic(supplier, customer, number)
    elif scenario == "line_discount":
        kw = _line_discount(supplier, customer, number)
    elif scenario == "doc_discount":
        kw = _doc_discount(supplier, customer, number)
    elif scenario == "mixed_vat":
        kw = _mixed_vat(supplier, customer, number)
    elif scenario == "multi_line_basket":
        kw = _multi_line_basket(supplier, customer, number)
    elif scenario == "credit_note":
        kw = _credit_note(supplier, customer, number, basic_ref)
    elif scenario == "debit_note":
        kw = _debit_note(supplier, customer, number, basic_ref)
    else:
        raise ValueError(f"unknown scenario {scenario!r}")

    return _DOC_TYPE_TO_CLASS[doc_type](**kw)


def build_compliance_demo_set(
    *, cfg: CsrConfig, tenant: Tenant
) -> list[tuple[DemoKind, _InvoiceBase]]:
    """Build the full demo payload set dictated by ``cfg.invoice_type``."""
    supplier = _supplier_from_csr(cfg, tenant)
    scenarios = scenarios_for_invoice_type(cfg.invoice_type)

    # CN/DN reference the first basic invoice of the same family.
    b2b_basic_number = "DEMO-STD-001"
    b2c_basic_number = "DEMO-SIM-001"

    out: list[tuple[DemoKind, _InvoiceBase]] = []
    seq_b2b = 0
    seq_b2c = 0
    for scenario, doc_type in scenarios:
        is_b2c = doc_type.startswith("simplified")
        if is_b2c:
            seq_b2c += 1
            ref = b2c_basic_number
            seq = seq_b2c
        else:
            seq_b2b += 1
            ref = b2b_basic_number
            seq = seq_b2b
        out.append((doc_type, _build_one(scenario, doc_type, supplier, is_b2c, seq, ref)))
    return out
