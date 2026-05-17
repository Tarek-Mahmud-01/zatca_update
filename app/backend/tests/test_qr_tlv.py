"""TLV decoder round-trip for our QR encoder.

We assert that ``build_tlv`` produces well-formed TLV records that we can decode
back into the original fields, that lengths are correct, and that tag 9 only
appears when ``cert_signature_b64`` is supplied (mirroring SDK behavior).
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


def test_tlv_round_trip_simplified() -> None:
    tlv = build_tlv(_fields(cert_sig=None))
    decoded = dict(_decode_tlv(tlv))
    assert decoded[1].decode() == "Maximum Speed Tech Supply LTD"
    assert decoded[2].decode() == "399999999900003"
    assert decoded[3].decode() == "2022-08-17T17:41:08"
    assert decoded[4].decode() == "231.15"
    assert decoded[5].decode() == "30.15"
    assert decoded[6].decode() == "Hss2gNFjBY5OJn/5CEVZSSNUMrSf4QlCMxwsioPN6fA="
    assert 9 not in decoded  # simplified must NOT include cert signature


def test_tlv_round_trip_standard_includes_cert_signature() -> None:
    cert_sig = base64.b64encode(b"\xbb" * 71).decode()
    tlv = build_tlv(_fields(cert_sig=cert_sig))
    decoded = dict(_decode_tlv(tlv))
    assert 9 in decoded
    assert decoded[9] == b"\xbb" * 71


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
