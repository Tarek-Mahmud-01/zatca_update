"""End-to-end pipeline: payload -> UBL XML -> sign -> QR -> ready for ZATCA.

Every demo scenario from build_compliance_demo_set should round-trip cleanly:
  * Parse as valid XML
  * Contain a signed Signature block
  * Contain a real (non-placeholder) QR
  * Have a computable invoice hash that matches the embedded SignedInfo digest
"""
import base64
import hashlib
from uuid import uuid4

import pytest
from lxml import etree

from app.zatca.canonicalize import NS, canonicalize_for_invoice_hash
from app.zatca.demo import build_compliance_demo_set
from app.zatca.keys import generate_private_key, serialize_private_key_pem
from app.zatca.pipeline import process_invoice
from tests.test_demo import _cfg, _tenant
from tests.test_sign_known_vector import TEST_CERT_PEM


@pytest.fixture(scope="module")
def signing_material() -> tuple[str, str]:
    """One throwaway key + cert pair used for every demo signing test."""
    key = generate_private_key()
    return serialize_private_key_pem(key), TEST_CERT_PEM


@pytest.mark.parametrize("bitmask,expected_count", [("1000", 6), ("0100", 6), ("1100", 12)])
def test_every_demo_payload_signs_cleanly(
    bitmask: str, expected_count: int, signing_material: tuple[str, str]
) -> None:
    private_key_pem, cert_pem = signing_material
    payloads = build_compliance_demo_set(cfg=_cfg(bitmask), tenant=_tenant())
    assert len(payloads) == expected_count

    pih = base64.b64encode(b"\x00" * 32).decode()
    icv = 0
    for _doc_type, raw in payloads:
        icv += 1
        bound = raw.model_copy(update={"icv": icv, "pih_b64": pih, "uuid": uuid4()})
        out = process_invoice(
            bound, private_key_pem=private_key_pem, certificate_pem=cert_pem
        )
        # Structural assertions on the produced XML
        root = etree.fromstring(out.signed_xml)
        assert root.tag.endswith("}Invoice")

        sig = root.find(".//ds:Signature", namespaces=NS)
        assert sig is not None and sig.get("Id") == "signature"

        # QR must have been injected (placeholder is gone)
        qr_node = root.xpath(
            ".//cac:AdditionalDocumentReference[cbc:ID='QR']//cbc:EmbeddedDocumentBinaryObject",
            namespaces=NS,
        )
        assert qr_node and qr_node[0].text != "QR_PLACEHOLDER"
        assert qr_node[0].text == out.qr_b64

        # The DigestValue of the invoice reference must equal our hash function's
        # output applied to the same canonical form. This is the "we and ZATCA see
        # the same bytes" check.
        digest_node = root.xpath(
            ".//ds:Reference[@Id='invoiceSignedData']/ds:DigestValue",
            namespaces=NS,
        )
        assert digest_node and digest_node[0].text == out.invoice_hash_b64

        canon = canonicalize_for_invoice_hash(out.signed_xml)
        assert base64.b64encode(hashlib.sha256(canon).digest()).decode() == out.invoice_hash_b64

        # Advance the PIH chain to mimic what the API actually does
        pih = out.invoice_hash_b64


def test_pipeline_emits_root_allowance_for_doc_discount_scenario(
    signing_material: tuple[str, str]
) -> None:
    private_key_pem, cert_pem = signing_material
    payloads = build_compliance_demo_set(cfg=_cfg("1000"), tenant=_tenant())
    # Index 2 = doc_discount (verified in test_demo)
    raw = payloads[2][1]
    bound = raw.model_copy(update={"icv": 1, "pih_b64": "", "uuid": uuid4()})
    out = process_invoice(bound, private_key_pem=private_key_pem, certificate_pem=cert_pem)

    root = etree.fromstring(out.signed_xml)
    # Root-level AllowanceCharge present (the document discount)
    root_ac = root.xpath("./cac:AllowanceCharge", namespaces=NS)
    assert len(root_ac) == 1
    indicator = root_ac[0].find("cbc:ChargeIndicator", namespaces=NS).text
    assert indicator == "false"  # is_charge=False means discount

    # AllowanceTotalAmount in monetary totals == 100
    alw = root.xpath(".//cac:LegalMonetaryTotal/cbc:AllowanceTotalAmount", namespaces=NS)
    assert alw and alw[0].text == "100.00"


def test_pipeline_emits_inline_discount_with_chargeindicator_false(
    signing_material: tuple[str, str]
) -> None:
    private_key_pem, cert_pem = signing_material
    payloads = build_compliance_demo_set(cfg=_cfg("1000"), tenant=_tenant())
    raw = payloads[1][1]  # line_discount scenario
    bound = raw.model_copy(update={"icv": 1, "pih_b64": "", "uuid": uuid4()})
    out = process_invoice(bound, private_key_pem=private_key_pem, certificate_pem=cert_pem)

    root = etree.fromstring(out.signed_xml)
    # Inline AllowanceCharge inside the first line's <cac:Price>
    inline = root.xpath(
        ".//cac:InvoiceLine[cbc:ID='1']/cac:Price/cac:AllowanceCharge",
        namespaces=NS,
    )
    assert len(inline) == 1
    indicator = inline[0].find("cbc:ChargeIndicator", namespaces=NS).text
    assert indicator == "false"  # discount = allowance, NOT charge


def test_pipeline_emits_two_taxsubtotal_blocks_for_mixed_vat(
    signing_material: tuple[str, str]
) -> None:
    private_key_pem, cert_pem = signing_material
    payloads = build_compliance_demo_set(cfg=_cfg("1000"), tenant=_tenant())
    raw = payloads[3][1]  # mixed_vat scenario
    bound = raw.model_copy(update={"icv": 1, "pih_b64": "", "uuid": uuid4()})
    out = process_invoice(bound, private_key_pem=private_key_pem, certificate_pem=cert_pem)

    root = etree.fromstring(out.signed_xml)
    # The "detail" TaxTotal carries the per-category subtotals
    subtotals = root.xpath(".//cac:TaxTotal/cac:TaxSubtotal", namespaces=NS)
    assert len(subtotals) == 2
    cat_codes = {
        st.find(".//cac:TaxCategory/cbc:ID", namespaces=NS).text for st in subtotals
    }
    assert cat_codes == {"S", "Z"}
