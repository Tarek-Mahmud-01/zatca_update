"""Invoice hash — replaces `fatoora -generateHash`.

The SDK emits the base64 of the raw SHA-256 digest bytes of the canonicalized
invoice (after the three XPath transforms in canonicalize.py). The ZATCA QR's
TLV tag 6 carries exactly that base64 string.
"""
from __future__ import annotations

import base64
import hashlib

from app.zatca.canonicalize import canonicalize_for_invoice_hash


def compute_invoice_hash(xml: bytes | str) -> str:
    """Return base64(sha256(canonicalized invoice))."""
    canon = canonicalize_for_invoice_hash(xml)
    digest = hashlib.sha256(canon).digest()
    return base64.b64encode(digest).decode()


def compute_invoice_hash_hex(xml: bytes | str) -> str:
    """Hex form — used internally by the XAdES signer when building SignedProperties."""
    canon = canonicalize_for_invoice_hash(xml)
    return hashlib.sha256(canon).hexdigest()
