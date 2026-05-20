"""TLV decoder round-trip for our QR encoder.

Encoding rules verified end-to-end against ZATCA sandbox (all 12 compliance
invoices CLEARED/REPORTED):
  * Tags 1-7 are STRINGS — tag 6 (hash) and tag 7 (signature) are the
    *base64 strings*, not decoded bytes.
  * Tag 7 signature is DER-encoded ECDSA (set by the signer).
  * Tags 8-9 are RAW BINARY (public key SPKI DER, certificate signature).
  * Tag 9 is included whenever cert_signature_b64 is supplied; the pipeline
    now supplies it for ALL invoice types (simplified included), because the
    SDK reference simplified QR carries it and ZATCA rejects QRs without it.
"""
import base64
import dataclasses

import pytest

from app.zatca.qr import QrFields, build_tlv, encode_qr_base64


def _decode_tlv(buf: bytes) -> list[tuple[int, bytes]]:
    out: list[tuple[int, bytes]] = []
    i = 0
    while i < len(buf):
        tag = buf[i]
        i += 1
        first = buf[i]
        i += 1
        if first < 0x80:
            length = first
        elif first == 0x81:
            length = buf[i]
            i += 1
        elif first == 0x82:
            length = int.from_bytes(buf[i:i + 2], "big")
            i += 2
        else:
            raise ValueError(f"bad length byte {first}")
        out.append((tag, buf[i:i + length]))
        i += length
    return out


def _fields(cert_sig: str | None) -> QrFields:
    return QrFields(
        seller_name="Maximum Speed Tech Supply LTD",
        vat_number="399999999900003",
        timestamp="2022-08-17T17:41:08",
        invoice_total="231.15",
        vat_amount="30.15",
        invoice_hash_b64="Hss2gNFjBY5OJn/5CEVZSSNUMrSf4QlCMxwsioPN6fA=",
        signature_b64=base64.b64encode(b"\x00" * 64).decode(),
        public_key_der_b64=base64.b64encode(b"\xaa" * 91).decode(),
        cert_signature_b64=cert_sig,
    )


def test_tlv_tags_1_to_7_are_strings() -> None:
    tlv = build_tlv(_fields(cert_sig=None))
    decoded = dict(_decode_tlv(tlv))
    assert decoded[1].decode() == "Maximum Speed Tech Supply LTD"
    assert decoded[2].decode() == "399999999900003"
    assert decoded[3].decode() == "2022-08-17T17:41:08"
    assert decoded[4].decode() == "231.15"
    assert decoded[5].decode() == "30.15"
    # Tag 6 is the base64 hash STRING, not the decoded 32-byte digest.
    assert decoded[6].decode() == "Hss2gNFjBY5OJn/5CEVZSSNUMrSf4QlCMxwsioPN6fA="


def test_tag7_is_base64_signature_string_not_raw_bytes() -> None:
    """Regression: tag 7 must carry the base64 signature STRING (its UTF-8
    bytes), not the decoded signature. Decoding it caused
    INVOICE_SIGNATURE_VALUE_QRCODE_INVALID against ZATCA.
    """
    sig_b64 = base64.b64encode(b"\x30\x45\x02" + b"\x11" * 60).decode()
    fields = dataclasses.replace(_fields(cert_sig=None), signature_b64=sig_b64)
    decoded = dict(_decode_tlv(build_tlv(fields)))
    assert decoded[7].decode() == sig_b64


def test_tlv_includes_cert_signature_when_supplied() -> None:
    cert_sig = base64.b64encode(b"\xbb" * 71).decode()
    tlv = build_tlv(_fields(cert_sig=cert_sig))
    decoded = dict(_decode_tlv(tlv))
    assert 9 in decoded
    assert decoded[9] == b"\xbb" * 71  # raw binary, not base64 string


def test_qr_base64_is_decodable() -> None:
    b64 = encode_qr_base64(_fields(cert_sig=None))
    raw = base64.b64decode(b64)
    decoded = dict(_decode_tlv(raw))
    assert decoded[1].decode().startswith("Maximum")


@pytest.mark.parametrize("name_len", [10, 128, 250])
def test_tlv_handles_short_and_long_values(name_len: int) -> None:
    fields = dataclasses.replace(_fields(cert_sig=None), seller_name="a" * name_len)
    tlv = build_tlv(fields)
    decoded = dict(_decode_tlv(tlv))
    assert decoded[1].decode() == ("a" * name_len)
