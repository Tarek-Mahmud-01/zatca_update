"""Generate signed XML + QR PNG + JSON payload + metadata for every invoice type.

Run with:
    .venv/Scripts/python.exe -m app.scripts.generate_signed_set

Produces a tree like:

    generated/
      README.md                            # human-readable index
      index.json                           # machine-readable index
      _signing/
        cert.pem                           # the dev self-signed cert used
        private_key.pem                    # the matching EC secp256k1 key
      standard_b2b/01_basic/
          payload.json                     # input JSON
          signed.xml                       # signed UBL (with QR injected)
          qr.png                           # scannable QR (TLV-encoded, base64)
          qr.b64.txt                       # base64 TLV (the text inside the QR)
          meta.json                        # icv, uuid, invoice_hash, signature
      standard_b2b/02_line_discount/...
      simplified_b2c/01_basic/...
      ...
      other_types/export_invoice/...

The signing key is a fresh dev cert (NOT a ZATCA-issued one) — the produced
invoices are byte-valid UBL/XAdES with a real ECDSA signature, but the chain of
trust ends at our self-signed cert. To produce ZATCA-acceptable invoices, swap
``_signing/cert.pem`` for your production CSID's certificate and re-sign.
"""
from __future__ import annotations

import asyncio
import json
import shutil
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from uuid import UUID, uuid4

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID

from app.db.models import CsrConfig, Tenant
from app.zatca.demo import build_compliance_demo_set, scenarios_for_invoice_type
from app.zatca.pipeline import process_invoice
from app.zatca.qr import render_qr_png
from app.zatca.ubl_builder import (
    ExportInvoice,
    InvoiceLine,
    MonetaryTotals,
    Party,
    SelfBillingInvoice,
    SummaryInvoice,
    TaxSubtotal,
    _InvoiceBase,
)

OUT = Path(__file__).resolve().parents[3] / "generated"


# ---------------------------------------------------------------------------
# Signing material — fresh self-signed cert for dev demo
# ---------------------------------------------------------------------------


def _make_dev_signing_material() -> tuple[ec.EllipticCurvePrivateKey, x509.Certificate]:
    key = ec.generate_private_key(ec.SECP256K1())
    subject = x509.Name([
        x509.NameAttribute(NameOID.COMMON_NAME, "ZATCA Phase 2 Dev Demo"),
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
    return key, cert


def _serialize_key(key: ec.EllipticCurvePrivateKey) -> str:
    return key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.TraditionalOpenSSL,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode()


def _serialize_cert(cert: x509.Certificate) -> str:
    return cert.public_bytes(serialization.Encoding.PEM).decode()


# ---------------------------------------------------------------------------
# Tenant fixture — Al-Rukn-style identity (matches global.json defaults)
# ---------------------------------------------------------------------------


def _tenant() -> Tenant:
    t = Tenant(
        name="Al-Rukn Al-Hasan Trading Establishment",
        vat_number="300025187600003",
        organization_identifier="300025187600003",
    )
    t.id = uuid4()
    now = datetime.now(timezone.utc)
    t.created_at = now
    t.updated_at = now
    return t


def _cfg(bitmask: str) -> CsrConfig:
    return CsrConfig(
        tenant_id=uuid4(),
        env="sandbox",
        common_name="GuruERP-ARAH",
        serial_number="1-DTG|2-GuruERP|3-V320252",
        organization_identifier="300025187600003",
        organization_unit_name="Al-Rukn Al-Hasan Trading Establishment",
        organization_name="Al-Rukn Al-Hasan Trading Establishment",
        country_name="SA",
        invoice_type=bitmask,
        location_address="Riyadh, Al-Naseem Al-Sharqi, Abdullah bin Suleim, 11689",
        industry_business_category="Trading for Cooling Spare Parts",
    )


# ---------------------------------------------------------------------------
# Specialty doc types (export/summary/self-billing) — built directly
# ---------------------------------------------------------------------------


def _supplier() -> Party:
    return Party(
        registration_name="Al-Rukn Al-Hasan Trading Establishment",
        vat_number="300025187600003",
        crn="300025187600003",
        street="Abdullah bin Suleim",
        building_number="0001",
        city_subdivision="Al-Naseem Al-Sharqi",
        city="Riyadh",
        postal_zone="11689",
        country_code="SA",
    )


def _b2b_customer() -> Party:
    return Party(
        registration_name="Demo B2B Buyer LTD",
        vat_number="399999999800003",
        street="Salah Al-Din",
        building_number="1111",
        city_subdivision="Al-Murooj",
        city="Riyadh",
        postal_zone="12222",
        country_code="SA",
    )


def _export_customer() -> Party:
    return Party(
        registration_name="Foreign Buyer GmbH",
        street="Friedrichstrasse",
        building_number="50",
        city_subdivision="Mitte",
        city="Berlin",
        postal_zone="10117",
        country_code="DE",
    )


def _basic_kw(supplier: Party, customer: Party, invoice_number: str) -> dict:
    now = datetime.now(timezone.utc)
    line = InvoiceLine(
        id="1", name="Demo item",
        quantity=Decimal("1"), unit_code="PCE",
        unit_price=Decimal("100.00"),
        line_extension=Decimal("100.00"),
        tax_amount=Decimal("15.00"),
        rounding_amount=Decimal("115.00"),
        tax_percent=Decimal("15"),
    )
    subtotal = TaxSubtotal(taxable_amount=Decimal("100.00"), tax_amount=Decimal("15.00"))
    return dict(
        invoice_number=invoice_number,
        uuid=uuid4(),
        issue_date=date.today(),
        issue_time=time(now.hour, now.minute, now.second),
        icv=0,
        pih_b64="",
        supplier=supplier,
        customer=customer,
        lines=[line],
        tax_subtotals=[subtotal],
        monetary_totals=MonetaryTotals(
            line_extension=Decimal("100.00"),
            tax_exclusive=Decimal("100.00"),
            tax_inclusive=Decimal("115.00"),
            payable_amount=Decimal("115.00"),
        ),
        payment_means_code="10",
        notes=[],
    )


def _specialty_payloads() -> list[tuple[str, _InvoiceBase]]:
    """Doc types that aren't in the demo compliance set but still need coverage."""
    supplier = _supplier()
    out: list[tuple[str, _InvoiceBase]] = []

    out.append(("export_invoice", ExportInvoice(
        **_basic_kw(supplier, _export_customer(), "DEMO-EXPORT-001"),
    )))
    out.append(("summary_invoice", SummaryInvoice(
        **_basic_kw(supplier, _b2b_customer(), "DEMO-SUMMARY-001"),
    )))
    out.append(("self_billing_invoice", SelfBillingInvoice(
        **_basic_kw(supplier, _b2b_customer(), "DEMO-SELFBILL-001"),
    )))
    # Advance payment and nominal supply are part of the simplified-family
    # in our ProfileID logic, so they're already in the 1100 demo set. We add
    # standalone instances here for direct inspection too.
    from app.zatca.ubl_builder import AdvancePaymentInvoice, NominalSupplyInvoice
    out.append(("advance_payment_invoice", AdvancePaymentInvoice(
        **_basic_kw(supplier, _b2b_customer(), "DEMO-ADVANCE-001"),
    )))
    out.append(("nominal_supply_invoice", NominalSupplyInvoice(
        **_basic_kw(supplier, _b2b_customer(), "DEMO-NOMINAL-001"),
    )))
    return out


# ---------------------------------------------------------------------------
# Per-invoice output writer
# ---------------------------------------------------------------------------


def _write_artifacts(
    base_dir: Path, payload: _InvoiceBase, key_pem: str, cert_pem: str, icv: int, pih: str,
) -> dict:
    base_dir.mkdir(parents=True, exist_ok=True)

    bound = payload.model_copy(update={"icv": icv, "pih_b64": pih, "uuid": uuid4()})

    # 1. payload.json — the input
    (base_dir / "payload.json").write_text(
        bound.model_dump_json(indent=2),
        encoding="utf-8",
    )

    # 2. sign + QR
    result = process_invoice(bound, private_key_pem=key_pem, certificate_pem=cert_pem)

    # 3. signed.xml
    (base_dir / "signed.xml").write_bytes(result.signed_xml)

    # 4. qr.png + qr.b64.txt
    (base_dir / "qr.png").write_bytes(render_qr_png(result.qr_b64))
    (base_dir / "qr.b64.txt").write_text(result.qr_b64, encoding="utf-8")

    # 5. meta.json
    meta = {
        "doc_type": bound.doc_type,
        "invoice_number": bound.invoice_number,
        "uuid": str(bound.uuid),
        "icv": icv,
        "pih_b64": pih,
        "invoice_hash_b64": result.invoice_hash_b64,
        "signed_at": datetime.now(timezone.utc).isoformat(),
        "byte_lengths": {
            "signed_xml": len(result.signed_xml),
            "qr_base64": len(result.qr_b64),
        },
    }
    (base_dir / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")

    return meta


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------


async def main() -> None:
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)

    print(f"Output directory: {OUT}")
    print()

    # Write signing material
    key, cert = _make_dev_signing_material()
    key_pem = _serialize_key(key)
    cert_pem = _serialize_cert(cert)
    signing_dir = OUT / "_signing"
    signing_dir.mkdir(parents=True)
    (signing_dir / "private_key.pem").write_text(key_pem, encoding="utf-8")
    (signing_dir / "cert.pem").write_text(cert_pem, encoding="utf-8")
    (signing_dir / "README.txt").write_text(
        "Dev-only self-signed EC secp256k1 cert used for these demo signatures.\n"
        "Replace with your production CSID's certificate to produce ZATCA-acceptable invoices.\n",
        encoding="utf-8",
    )
    print(f"  wrote {signing_dir}/private_key.pem + cert.pem")
    print()

    tenant = _tenant()
    index: list[dict] = []

    # ---- B2B compliance demo set (6 scenarios) ----
    print("=== B2B (Standard / clearance) ===")
    b2b_payloads = build_compliance_demo_set(cfg=_cfg("1000"), tenant=tenant)
    b2b_scenarios = scenarios_for_invoice_type("1000")
    pih = "NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ=="
    for icv, ((scenario, doc_type), (_kind, payload)) in enumerate(zip(b2b_scenarios, b2b_payloads, strict=True), start=1):
        folder = OUT / "standard_b2b" / f"{icv:02d}_{scenario}"
        meta = _write_artifacts(folder, payload, key_pem, cert_pem, icv, pih)
        print(f"  [{icv}] {scenario:20} -> {folder.relative_to(OUT)}")
        index.append({"family": "standard_b2b", "scenario": scenario, **meta})
        pih = meta["invoice_hash_b64"]
    print()

    # ---- B2C compliance demo set (6 scenarios) ----
    print("=== B2C (Simplified / reporting) ===")
    b2c_payloads = build_compliance_demo_set(cfg=_cfg("0100"), tenant=tenant)
    b2c_scenarios = scenarios_for_invoice_type("0100")
    pih = "NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ=="
    for icv, ((scenario, doc_type), (_kind, payload)) in enumerate(zip(b2c_scenarios, b2c_payloads, strict=True), start=1):
        folder = OUT / "simplified_b2c" / f"{icv:02d}_{scenario}"
        meta = _write_artifacts(folder, payload, key_pem, cert_pem, icv, pih)
        print(f"  [{icv}] {scenario:20} -> {folder.relative_to(OUT)}")
        index.append({"family": "simplified_b2c", "scenario": scenario, **meta})
        pih = meta["invoice_hash_b64"]
    print()

    # ---- Specialty doc types ----
    print("=== Specialty doc types ===")
    pih = "NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ=="
    for icv, (name, payload) in enumerate(_specialty_payloads(), start=1):
        folder = OUT / "other_types" / name
        meta = _write_artifacts(folder, payload, key_pem, cert_pem, icv, pih)
        print(f"  [{icv}] {name:24} -> {folder.relative_to(OUT)}")
        index.append({"family": "other_types", "scenario": name, **meta})
        pih = meta["invoice_hash_b64"]
    print()

    # ---- Index files ----
    (OUT / "index.json").write_text(
        json.dumps(index, indent=2, default=str),
        encoding="utf-8",
    )

    readme = [
        "# Generated signed invoices",
        "",
        f"Generated at {datetime.now(timezone.utc).isoformat()}.",
        "Each subfolder contains:",
        "  - payload.json    the input JSON",
        "  - signed.xml      the signed UBL invoice (with QR injected)",
        "  - qr.png          scannable QR code (TLV-encoded, base64 envelope)",
        "  - qr.b64.txt      the text inside the QR (base64 TLV)",
        "  - meta.json       icv, uuid, invoice_hash_b64, signed_at, byte lengths",
        "",
        "## Index",
        "",
    ]
    for entry in index:
        readme.append(
            f"- **{entry['family']}/{entry['scenario']}** — "
            f"{entry['doc_type']} — `{entry['invoice_number']}` — "
            f"hash `{entry['invoice_hash_b64'][:24]}…`"
        )
    readme.append("")
    readme.append("## Signing material")
    readme.append("")
    readme.append("Dev self-signed cert under `_signing/`. Replace with your production CSID's cert to produce ZATCA-acceptable invoices.")
    (OUT / "README.md").write_text("\n".join(readme), encoding="utf-8")

    print(f"Wrote {len(index)} invoices.")
    print(f"  index : {OUT}/index.json")
    print(f"  readme: {OUT}/README.md")


if __name__ == "__main__":
    asyncio.run(main())
