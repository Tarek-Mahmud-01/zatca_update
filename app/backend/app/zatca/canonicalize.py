"""XML canonicalization (C14N 1.1) for ZATCA invoice hashing and signing.

ZATCA's SDK references three XPath transforms that must be applied **before** the
SHA-256 of the invoice is taken. See Data/Samples/Simplified/Invoice/Simplified_Invoice.xml
lines 15-25:

    not(//ancestor-or-self::ext:UBLExtensions)
    not(//ancestor-or-self::cac:Signature)
    not(//ancestor-or-self::cac:AdditionalDocumentReference[cbc:ID='QR'])

These remove (a) the entire signature block, (b) the Signature placeholder, and (c) the
QR doc reference — so the resulting digest is over the "pure" invoice content only.

We use lxml's c14n11 (method='c14n', exclusive=False, with_comments=False) which is
exactly what the SDK's java canonicalizer emits.
"""
from __future__ import annotations

from lxml import etree

NS = {
    "ubl": "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
    "cac": "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
    "cbc": "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
    "ext": "urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2",
    "ds": "http://www.w3.org/2000/09/xmldsig#",
    "xades": "http://uri.etsi.org/01903/v1.3.2#",
    "sig": "urn:oasis:names:specification:ubl:schema:xsd:CommonSignatureComponents-2",
    "sac": "urn:oasis:names:specification:ubl:schema:xsd:SignatureAggregateComponents-2",
    "sbc": "urn:oasis:names:specification:ubl:schema:xsd:SignatureBasicComponents-2",
}


def parse(xml: bytes | str) -> etree._Element:
    if isinstance(xml, str):
        xml = xml.encode()
    return etree.fromstring(xml)


def canonicalize(element: etree._Element) -> bytes:
    """C14N 1.1, no comments, inclusive."""
    return etree.tostring(element, method="c14n", exclusive=False, with_comments=False)


def _strip_for_invoice_hash(root: etree._Element) -> etree._Element:
    """Apply the three SDK XPath transforms.

    Returns a deep copy with the matching subtrees removed. Crucially, the
    *tail* (whitespace after the closing tag) of each removed element is
    preserved by splicing it onto the previous sibling or onto the parent's
    text — this is exactly what Bouncy Castle's C14N 1.1 does, and the only
    way to reach byte-equality with the SDK's reference hash on
    Simplified_Invoice.xml (Hss2gNFjBY5OJn/5CEVZSSNUMrSf4QlCMxwsioPN6fA=).
    """
    cloned = etree.fromstring(etree.tostring(root))

    xpath_targets = [
        ".//ext:UBLExtensions",
        ".//cac:Signature",
        ".//cac:AdditionalDocumentReference[cbc:ID='QR']",
    ]
    for xp in xpath_targets:
        for node in cloned.xpath(xp, namespaces=NS):
            parent = node.getparent()
            if parent is None:
                continue
            tail = node.tail or ""
            prev = node.getprevious()
            if prev is not None:
                prev.tail = (prev.tail or "") + tail
            else:
                parent.text = (parent.text or "") + tail
            parent.remove(node)
    return cloned


def canonicalize_for_invoice_hash(xml: bytes | str) -> bytes:
    """Public helper — produce the canonical bytes that are SHA-256'd for the invoice hash."""
    root = parse(xml)
    stripped = _strip_for_invoice_hash(root)
    return canonicalize(stripped)
