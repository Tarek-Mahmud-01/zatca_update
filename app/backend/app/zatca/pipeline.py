"""End-to-end invoice processing pipeline: payload -> UBL -> sign -> QR -> done."""
from __future__ import annotations

import base64
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal

from app.zatca.keys import load_private_key_pem, public_key_der_base64
from app.zatca.qr import QrFields, encode_qr_base64
from app.zatca.sign import cert_signature_b64, sign_invoice
from app.zatca.ubl_builder import _InvoiceBase, build_unsigned_ubl, inject_qr


@dataclass(frozen=True, slots=True)
class ProcessedInvoice:
    signed_xml: bytes
    invoice_hash_b64: str
    qr_b64: str


def _is_standard_doc(doc_type: str) -> bool:
    return doc_type.startswith("standard") or doc_type in {
        "export_invoice",
        "summary_invoice",
        "self_billing_invoice",
    }


def process_invoice(
    payload: _InvoiceBase,
    *,
    private_key_pem: str,
    certificate_pem: str,
) -> ProcessedInvoice:
    """Build, sign, generate QR, inject it, return final bytes."""
    unsigned = build_unsigned_ubl(payload)

    private_key = load_private_key_pem(private_key_pem)
    sign_result = sign_invoice(
        invoice_xml=unsigned,
        private_key=private_key,
        certificate_pem=certificate_pem,
        signing_time=datetime.now(timezone.utc),
    )

    timestamp = f"{payload.issue_date.isoformat()}T{payload.issue_time.strftime('%H:%M:%S')}"
    total: Decimal = payload.monetary_totals.tax_inclusive
    vat_amount: Decimal = sum(
        (s.tax_amount for s in payload.tax_subtotals), Decimal("0")
    )

    qr_fields = QrFields(
        seller_name=payload.supplier.registration_name,
        vat_number=payload.supplier.vat_number or "",
        timestamp=timestamp,
        invoice_total=f"{total:.2f}",
        vat_amount=f"{vat_amount:.2f}",
        invoice_hash_b64=sign_result.invoice_hash_b64,
        signature_b64=sign_result.signature_b64,
        public_key_der_b64=public_key_der_base64(private_key),
        # Tag 9 (certificate signature) is present in the SDK reference QR for
        # BOTH standard and simplified invoices — ZATCA's reporting QR check
        # rejects simplified QRs that omit it (QRCODE_INVALID). Always include.
        cert_signature_b64=cert_signature_b64(certificate_pem),
    )
    qr_b64 = encode_qr_base64(qr_fields)

    final_xml = inject_qr(sign_result.signed_xml, qr_b64)
    return ProcessedInvoice(
        signed_xml=final_xml,
        invoice_hash_b64=sign_result.invoice_hash_b64,
        qr_b64=qr_b64,
    )


def signed_xml_to_b64(signed_xml: bytes) -> str:
    return base64.b64encode(signed_xml).decode()
