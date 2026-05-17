"""Compliance demo generator tests.

Behavior we lock down:
  * Bitmask -> count: 1000 = 6 (B2B), 0100 = 6 (B2C), 1100 = 12 (both)
  * 1100 emits B2B first (clearance family) then B2C (reporting family)
  * The B2B set covers all four pricing primitives the user explicitly asked for:
    basic, line discount, document discount, mixed VAT — plus CN + DN
  * Bad bitmasks raise (ValueError)
"""
from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

import pytest

from app.db.models import CsrConfig, Tenant
from app.zatca.demo import (
    build_compliance_demo_set,
    doc_types_for_invoice_type,
    scenarios_for_invoice_type,
)


def _cfg(bitmask: str = "1100") -> CsrConfig:
    return CsrConfig(
        tenant_id=uuid4(),
        env="sandbox",
        common_name="TST",
        serial_number="1-TST|2-TST|3-uuid",
        organization_identifier="300000000000003",
        organization_unit_name="HQ",
        organization_name="Demo Co",
        country_name="SA",
        invoice_type=bitmask,
        location_address="Riyadh",
        industry_business_category="Trading",
    )


def _tenant() -> Tenant:
    t = Tenant(
        name="Demo Co",
        vat_number="300000000000003",
        organization_identifier="300000000000003",
    )
    t.id = uuid4()
    now = datetime.now(timezone.utc)
    t.created_at = now
    t.updated_at = now
    return t


# ---------------------------------------------------------------------------
# scenarios_for_invoice_type
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("bitmask,expected_count", [("1000", 6), ("0100", 6), ("1100", 12)])
def test_scenario_count_matches_bitmask(bitmask: str, expected_count: int) -> None:
    assert len(scenarios_for_invoice_type(bitmask)) == expected_count


def test_b2b_set_covers_all_four_pricing_primitives_plus_cn_dn() -> None:
    scenarios = scenarios_for_invoice_type("1000")
    names = [s for s, _ in scenarios]
    assert names == ["basic", "line_discount", "doc_discount", "mixed_vat", "credit_note", "debit_note"]


def test_b2c_set_is_retail_shaped() -> None:
    scenarios = scenarios_for_invoice_type("0100")
    names = [s for s, _ in scenarios]
    assert names == ["basic", "line_discount", "multi_line_basket", "mixed_vat", "credit_note", "debit_note"]


def test_1100_emits_b2b_first_then_b2c() -> None:
    scenarios = scenarios_for_invoice_type("1100")
    doc_types = [d for _, d in scenarios]
    assert doc_types[:6] == ["standard_invoice"] * 4 + ["standard_credit_note", "standard_debit_note"]
    assert doc_types[6:] == ["simplified_invoice"] * 4 + ["simplified_credit_note", "simplified_debit_note"]


def test_doc_types_for_invoice_type_back_compat() -> None:
    doc_types = doc_types_for_invoice_type("1000")
    assert all(d.startswith("standard") for d in doc_types)
    assert len(doc_types) == 6


@pytest.mark.parametrize("bitmask", ["0000", "abcd", "11", "11000", "0010", "0001"])
def test_bad_bitmask_raises(bitmask: str) -> None:
    with pytest.raises(ValueError):
        scenarios_for_invoice_type(bitmask)


# ---------------------------------------------------------------------------
# build_compliance_demo_set — full payloads
# ---------------------------------------------------------------------------


def test_b2b_payloads_have_consistent_arithmetic() -> None:
    """Every demo invoice's monetary totals must match the line extensions +
    tax exactly — otherwise ZATCA's schematron will reject."""
    payloads = build_compliance_demo_set(cfg=_cfg("1000"), tenant=_tenant())
    assert len(payloads) == 6
    for _doc_type, p in payloads:
        line_ext_sum = sum((l.line_extension for l in p.lines), Decimal("0"))
        line_tax_sum = sum((l.tax_amount for l in p.lines), Decimal("0"))
        subtotal_taxable_sum = sum((s.taxable_amount for s in p.tax_subtotals), Decimal("0"))
        subtotal_tax_sum = sum((s.tax_amount for s in p.tax_subtotals), Decimal("0"))

        mt = p.monetary_totals
        assert mt.line_extension == line_ext_sum, f"line_ext mismatch in {p.invoice_number}"
        # tax_exclusive = line_ext + charge_total - allowance_total
        expected_excl = mt.line_extension + mt.charge_total - mt.allowance_total
        assert mt.tax_exclusive == expected_excl, f"tax_exclusive mismatch in {p.invoice_number}"
        # tax_inclusive = tax_exclusive + sum(subtotal taxes)
        assert mt.tax_inclusive == mt.tax_exclusive + subtotal_tax_sum, (
            f"tax_inclusive mismatch in {p.invoice_number}"
        )
        # For doc-discount, the line-level tax sum is intentionally higher than
        # the subtotal tax sum (line ignores doc allowances). For all other
        # scenarios they should equal.
        if not mt.allowance_total and not mt.charge_total:
            assert line_tax_sum == subtotal_tax_sum, f"line/subtotal tax mismatch in {p.invoice_number}"
        # Taxable totals always sum to tax_exclusive.
        assert subtotal_taxable_sum == mt.tax_exclusive


def test_b2b_doc_discount_scenario_has_root_allowance() -> None:
    payloads = build_compliance_demo_set(cfg=_cfg("1000"), tenant=_tenant())
    # 3rd payload is doc_discount per the ordered lineup.
    doc_disc = payloads[2][1]
    assert doc_disc.invoice_number.startswith("DEMO-STD-003")
    assert len(doc_disc.document_charges) == 1
    dc = doc_disc.document_charges[0]
    assert dc.is_charge is False
    assert dc.amount == Decimal("100.00")
    assert doc_disc.monetary_totals.allowance_total == Decimal("100.00")


def test_b2b_line_discount_scenario_has_inline_discount() -> None:
    payloads = build_compliance_demo_set(cfg=_cfg("1000"), tenant=_tenant())
    line_disc = payloads[1][1]
    assert line_disc.invoice_number.startswith("DEMO-STD-002")
    bulk = line_disc.lines[0]
    assert bulk.discount_amount == Decimal("100.00")
    # 10*100 - 100 = 900 taxable on line 1, +200 on line 2 = 1100 total
    assert line_disc.monetary_totals.line_extension == Decimal("1100.00")


def test_b2b_mixed_vat_scenario_has_two_subtotals() -> None:
    payloads = build_compliance_demo_set(cfg=_cfg("1000"), tenant=_tenant())
    mixed = payloads[3][1]
    assert mixed.invoice_number.startswith("DEMO-STD-004")
    cats = {s.tax_category.value for s in mixed.tax_subtotals}
    assert cats == {"S", "Z"}
    # Zero-rated subtotal must carry exemption metadata.
    z = next(s for s in mixed.tax_subtotals if s.tax_category.value == "Z")
    assert z.exemption_reason_code is not None
    assert z.exemption_reason is not None


def test_cn_and_dn_reference_basic_invoice() -> None:
    payloads = build_compliance_demo_set(cfg=_cfg("1000"), tenant=_tenant())
    cn = payloads[4][1]
    dn = payloads[5][1]
    assert cn.billing_reference_id == "DEMO-STD-001"
    assert dn.billing_reference_id == "DEMO-STD-001"
    assert cn.instruction_note is not None
    assert dn.instruction_note is not None


def test_b2c_payloads_use_walkin_customer() -> None:
    payloads = build_compliance_demo_set(cfg=_cfg("0100"), tenant=_tenant())
    for _doc_type, p in payloads:
        # B2C never has a customer VAT number — the buyer is a walk-in
        assert p.customer.vat_number in (None, "")


def test_b2b_payloads_use_b2b_customer_with_vat() -> None:
    payloads = build_compliance_demo_set(cfg=_cfg("1000"), tenant=_tenant())
    for _doc_type, p in payloads:
        assert p.customer.vat_number, "B2B customer must have a VAT number"
