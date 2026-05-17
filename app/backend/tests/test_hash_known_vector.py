"""Hash byte-equivalence with the SDK's reference sample.

For Simplified_Invoice.xml the embedded ``<ds:DigestValue>`` over the canonical
invoice (with UBLExtensions/Signature/QR stripped) is:

    Hss2gNFjBY5OJn/5CEVZSSNUMrSf4QlCMxwsioPN6fA=

Our canonicalize_for_invoice_hash + sha256 + base64 pipeline reproduces this
byte-for-byte. The only non-obvious detail (which broke the test initially) is
that BC's C14N 1.1 preserves the *tail* whitespace of removed XPath subtrees —
see canonicalize._strip_for_invoice_hash for the fix.
"""
from app.zatca.hash import compute_invoice_hash

SIMPLIFIED_EXPECTED = "Hss2gNFjBY5OJn/5CEVZSSNUMrSf4QlCMxwsioPN6fA="
STANDARD_EXPECTED = "f+0WCqnPkInI+eL9G3LAry12fTPf+toC9UX07F4fI+s="


def test_simplified_invoice_hash_matches_sdk(simplified_invoice_sample: bytes) -> None:
    got = compute_invoice_hash(simplified_invoice_sample)
    assert got == SIMPLIFIED_EXPECTED, (
        f"hash mismatch with SDK\n  expected: {SIMPLIFIED_EXPECTED}\n  got:      {got}"
    )


def test_standard_invoice_hash_matches_sdk(standard_invoice_sample: bytes) -> None:
    got = compute_invoice_hash(standard_invoice_sample)
    assert got == STANDARD_EXPECTED, (
        f"hash mismatch with SDK\n  expected: {STANDARD_EXPECTED}\n  got:      {got}"
    )


def test_hash_function_is_deterministic_and_returns_b64_sha256(
    simplified_invoice_sample: bytes,
) -> None:
    """Sanity: same input -> same hash, and the result decodes as 32 bytes."""
    import base64
    a = compute_invoice_hash(simplified_invoice_sample)
    b = compute_invoice_hash(simplified_invoice_sample)
    assert a == b
    raw = base64.b64decode(a)
    assert len(raw) == 32, "expected raw SHA-256 (32 bytes)"
