"""EC secp256k1 key generation and serialization — replaces the SDK key half of `fatoora -csr`.

Notes (matching SDK behavior, see Readme/readme.md lines 350-360):
- Output PEM with header/footer for the public-facing "pem" form.
- Output BASE64-only body when callers ask for the non-pem form (the SDK strips
  `-----BEGIN/END EC PRIVATE KEY-----` and newlines for that mode).
"""
from __future__ import annotations

import base64

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec


def generate_private_key() -> ec.EllipticCurvePrivateKey:
    return ec.generate_private_key(ec.SECP256K1())


def serialize_private_key_pem(key: ec.EllipticCurvePrivateKey) -> str:
    return key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.TraditionalOpenSSL,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode()


def serialize_private_key_stripped(key: ec.EllipticCurvePrivateKey) -> str:
    """PEM body only — no header/footer, no newlines. Matches SDK non-pem mode."""
    pem = serialize_private_key_pem(key)
    body = "".join(
        line for line in pem.splitlines() if not line.startswith("-----") and line.strip()
    )
    return body


def load_private_key_pem(pem: str) -> ec.EllipticCurvePrivateKey:
    key = serialization.load_pem_private_key(pem.encode(), password=None)
    if not isinstance(key, ec.EllipticCurvePrivateKey):
        raise ValueError("not an EC private key")
    return key


def public_key_der_base64(key: ec.EllipticCurvePrivateKey) -> str:
    """SubjectPublicKeyInfo DER, base64 — the form embedded in TLV tag 8 of the QR."""
    der = key.public_key().public_bytes(
        encoding=serialization.Encoding.DER,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    return base64.b64encode(der).decode()
