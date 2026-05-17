"""Builder tests — the constructed UBL passes minimal structural checks."""
from datetime import date, time
from decimal import Decimal
from uuid import UUID

from lxml import etree

from app.zatca.canonicalize import NS
from app.zatca.ubl_builder import (
    InvoiceLine,
    MonetaryTotals,
    Party,
    SimplifiedInvoice,
    StandardInvoice,
    TaxSubtotal,
    build_unsigned_ubl,
)


def _supplier() -> Party:
    return Party(
        registration_name="Al-Rukn",
        vat_number="300025187600003",
        crn="1010010000",
        street="Suleim",
        building_number="0001",
        city_subdivision="Naseem",
        city="Riyadh",
        postal_zone="11689",
    )


def _customer() -> Party:
    return Party(
        registration_name="Customer Ltd",
        vat_number="399999999800003",
        street="Salah",
        building_number="1111",
        city_subdivision="Murooj",
        city="Riyadh",
        postal_zone="12222",
    )


def _lines() -> list[InvoiceLine]:
    return [
        InvoiceLine(
            id="1", name="Item", quantity=Decimal("1"), unit_price=Decimal("100"),
            line_extension=Decimal("100"), tax_amount=Decimal("15"),
            rounding_amount=Decimal("115"), tax_percent=Decimal("15"),
        )
    ]


def _subtotals() -> list[TaxSubtotal]:
    return [TaxSubtotal(taxable_amount=Decimal("100"), tax_amount=Decimal("15"))]


def _monetary() -> MonetaryTotals:
    return MonetaryTotals(
        line_extension=Decimal("100"), tax_exclusive=Decimal("100"),
        tax_inclusive=Decimal("115"), payable_amount=Decimal("115"),
    )


def test_simplified_invoice_type_code_attribute() -> None:
    payload = SimplifiedInvoice(
        invoice_number="INV-1",
        uuid=UUID("00000000-0000-0000-0000-000000000001"),
        issue_date=date(2026, 5, 16),
        issue_time=time(10, 0, 0),
        icv=1,
        pih_b64="abc",
        supplier=_supplier(),
        customer=_customer(),
        lines=_lines(),
        tax_subtotals=_subtotals(),
        monetary_totals=_monetary(),
    )
    xml = build_unsigned_ubl(payload)
    root = etree.fromstring(xml)
    tc = root.find("cbc:InvoiceTypeCode", namespaces=NS)
    assert tc is not None
    assert tc.text == "388"
    # Simplified family => name attribute starts with "02"
    assert (tc.get("name") or "").startswith("02")


def test_standard_invoice_type_code_attribute() -> None:
    payload = StandardInvoice(
        invoice_number="INV-2",
        uuid=UUID("00000000-0000-0000-0000-000000000002"),
        issue_date=date(2026, 5, 16),
        issue_time=time(10, 0, 0),
        icv=2,
        pih_b64="abc",
        supplier=_supplier(),
        customer=_customer(),
        lines=_lines(),
        tax_subtotals=_subtotals(),
        monetary_totals=_monetary(),
    )
    xml = build_unsigned_ubl(payload)
    root = etree.fromstring(xml)
    tc = root.find("cbc:InvoiceTypeCode", namespaces=NS)
    assert tc is not None
    assert tc.text == "388"
    assert (tc.get("name") or "").startswith("01")


def test_qr_placeholder_present(simplified_invoice_sample: bytes) -> None:
    # Defensive: ensure unsigned builder leaves a QR placeholder we can replace
    payload = SimplifiedInvoice(
        invoice_number="INV-3",
        uuid=UUID("00000000-0000-0000-0000-000000000003"),
        issue_date=date(2026, 5, 16),
        issue_time=time(10, 0, 0),
        icv=3,
        pih_b64="abc",
        supplier=_supplier(),
        customer=_customer(),
        lines=_lines(),
        tax_subtotals=_subtotals(),
        monetary_totals=_monetary(),
    )
    xml = build_unsigned_ubl(payload).decode()
    assert "QR_PLACEHOLDER" in xml
