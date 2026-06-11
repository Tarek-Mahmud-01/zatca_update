"""TLV QR encoder — replaces `fatoora -qr`.

Phase 2 ZATCA QR layout (TLV, base64-encoded):

    T1  seller name              (UTF-8 string)
    T2  VAT number               (digits)
    T3  invoice timestamp        (ISO 8601, e.g. 2022-08-17T17:41:08)
    T4  invoice total with VAT   (decimal string)
    T5  VAT amount               (decimal string)
    T6  invoice hash             (base64)
    T7  ECDSA signature          (base64)
    T8  public key DER           (base64)
    T9  certificate signature    (only present for STANDARD invoices)

Each TLV record is `tag byte || length byte (or LEN bytes) || value bytes`. ZATCA
uses a single-byte length for tags <128 octets, and a two-byte length (0x82 + 2
length bytes) for longer values. We implement both.

Encoded form: base64(concat(all TLV records)).
"""
from __future__ import annotations

import base64
from dataclasses import dataclass
from io import BytesIO

import qrcode


def _tlv(tag: int, value: bytes) -> bytes:
    length = len(value)
    if length < 0x80:
        return bytes([tag, length]) + value
    if length < 0x100:
        return bytes([tag, 0x81, length]) + value
    if length < 0x10000:
        return bytes([tag, 0x82]) + length.to_bytes(2, "big") + value
    raise ValueError("TLV value too large for ZATCA QR")


@dataclass(frozen=True, slots=True)
class QrFields:
    seller_name: str
    vat_number: str
    timestamp: str
    invoice_total: str
    vat_amount: str
    invoice_hash_b64: str
    signature_b64: str
    public_key_der_b64: str
    cert_signature_b64: str | None = None  # only for standard invoices


def build_tlv(fields: QrFields) -> bytes:
    """Build the ZATCA Phase-2 TLV QR payload.

    Tag encoding (verified against a working reference that passes ZATCA's
    simplified-invoice reporting check):
      * Tags 1-7 are STRINGS — their UTF-8 bytes. Critically, tag 6 (hash)
        and tag 7 (signature) are the *base64 strings*, NOT the decoded bytes.
        Decoding tag 7 to raw bytes causes INVOICE_SIGNATURE_VALUE_QRCODE_INVALID.
      * Tags 8-9 are RAW BINARY — the public key SPKI DER and the certificate
        signature bytes (we receive them base64-encoded, so decode once).
    """
    buf = b""
    buf += _tlv(1, fields.seller_name.encode("utf-8"))
    buf += _tlv(2, fields.vat_number.encode("utf-8"))
    buf += _tlv(3, fields.timestamp.encode("utf-8"))
    buf += _tlv(4, fields.invoice_total.encode("utf-8"))
    buf += _tlv(5, fields.vat_amount.encode("utf-8"))
    buf += _tlv(6, fields.invoice_hash_b64.encode("utf-8"))
    buf += _tlv(7, fields.signature_b64.encode("utf-8"))
    buf += _tlv(8, base64.b64decode(fields.public_key_der_b64))
    if fields.cert_signature_b64 is not None:
        buf += _tlv(9, base64.b64decode(fields.cert_signature_b64))
    return buf


def encode_qr_base64(fields: QrFields) -> str:
    return base64.b64encode(build_tlv(fields)).decode()


def render_qr_png(qr_base64: str) -> bytes:
    img = qrcode.make(qr_base64)
    buf = BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()
