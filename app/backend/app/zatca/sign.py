"""XAdES-B-B signer for ZATCA UBL invoices — replaces `fatoora -sign`.

Layout produced (see SDK sample
Data/Samples/Simplified/Invoice/Simplified_Invoice.xml lines 2-67):

    <ext:UBLExtensions>
      <ext:UBLExtension>
        <ext:ExtensionURI>urn:oasis:names:specification:ubl:dsig:enveloped:xades</...>
        <ext:ExtensionContent>
          <sig:UBLDocumentSignatures>
            <sac:SignatureInformation>
              <ds:Signature Id="signature">
                <ds:SignedInfo>
                  <ds:CanonicalizationMethod Algorithm="...c14n11"/>
                  <ds:SignatureMethod Algorithm="...ecdsa-sha256"/>
                  <ds:Reference Id="invoiceSignedData" URI="">
                    <ds:Transforms>...XPath x3 + c14n11</ds:Transforms>
                    <ds:DigestMethod Algorithm="...sha256"/>
                    <ds:DigestValue>{invoice_digest_b64}</ds:DigestValue>
                  </ds:Reference>
                  <ds:Reference Type="...SignatureProperties" URI="#xadesSignedProperties">
                    <ds:DigestMethod Algorithm="...sha256"/>
                    <ds:DigestValue>{signed_properties_digest_double_b64}</ds:DigestValue>
                  </ds:Reference>
                </ds:SignedInfo>
                <ds:SignatureValue>{signature_b64}</ds:SignatureValue>
                <ds:KeyInfo>
                  <ds:X509Data><ds:X509Certificate>{cert_b64_no_headers}</...></...>
                </ds:KeyInfo>
                <ds:Object>
                  <xades:QualifyingProperties Target="signature">
                    <xades:SignedProperties Id="xadesSignedProperties">
                      <xades:SignedSignatureProperties>
                        <xades:SigningTime>{iso8601}</xades:SigningTime>
                        <xades:SigningCertificate>
                          <xades:Cert>
                            <xades:CertDigest>
                              <ds:DigestMethod Algorithm="...sha256"/>
                              <ds:DigestValue>{cert_digest_hex_then_b64}</ds:DigestValue>
                            </xades:CertDigest>
                            <xades:IssuerSerial>
                              <ds:X509IssuerName>{rfc2253}</ds:X509IssuerName>
                              <ds:X509SerialNumber>{decimal}</ds:X509SerialNumber>
                            </xades:IssuerSerial>
                          </xades:Cert>
                        </xades:SigningCertificate>
                      </xades:SignedSignatureProperties>
                    </xades:SignedProperties>
                  </xades:QualifyingProperties>
                </ds:Object>
              </ds:Signature>
            </sac:SignatureInformation>
          </sig:UBLDocumentSignatures>
        </ext:ExtensionContent>
      </ext:UBLExtension>
    </ext:UBLExtensions>

The two non-obvious bits the SDK does:

1.  ``CertDigest`` and the SignedProperties reference digest are *double-encoded*:
    the digest is first hex-encoded, then base64-encoded. (Verified against the
    sample DigestValue ``NTUzMzVmMjE...`` which decodes to the hex string
    ``55335f2115dcc6dc4e625cd54355c0b33f4816bb9a96e2f9d933d7d3589b614d``.)

2.  ECDSA signature is **raw r||s** concatenation, base64-encoded — but the
    cryptography library hands us a DER blob, so we unwrap then re-encode.

Output: the original UBL bytes with a ``<ext:UBLExtensions>`` block inserted as
the first child of ``<Invoice>``, plus a trailing ``<cac:Signature>`` placeholder
(both are present in the SDK sample).
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import re
from dataclasses import dataclass
from datetime import datetime, timezone

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from lxml import etree

# Bouncy Castle's X500Name.toString() — the format ZATCA expects in
# <ds:X509IssuerName> — separates RDN components with ", " (comma + space),
# whereas Python's rfc4514_string() uses bare commas. The cert in the SDK
# sample shows it as "CN=PRZEINVOICESCA4-CA, DC=extgazt, DC=gov, DC=local";
# without this fix our digest of SignedProperties would never match ZATCA's.
_RFC4514_COMMA = re.compile(r"(?<!\\),")


def _bc_x500_string(name: x509.Name) -> str:
    """Format a DN in Bouncy Castle's default style (", " separator)."""
    return _RFC4514_COMMA.sub(", ", name.rfc4514_string())

from app.zatca.canonicalize import NS, canonicalize, canonicalize_for_invoice_hash
from app.zatca.hash import compute_invoice_hash

C14N11 = "http://www.w3.org/2006/12/xml-c14n11"
ECDSA_SHA256 = "http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256"
SHA256 = "http://www.w3.org/2001/04/xmlenc#sha256"
XPATH_REV = "http://www.w3.org/TR/1999/REC-xpath-19991116"
SIGPROPS_TYPE = "http://www.w3.org/2000/09/xmldsig#SignatureProperties"
EXT_URI = "urn:oasis:names:specification:ubl:dsig:enveloped:xades"


@dataclass(frozen=True, slots=True)
class SignResult:
    signed_xml: bytes
    invoice_hash_b64: str
    signature_b64: str
    cert_b64_no_headers: str


def _strip_cert(cert_pem: str) -> str:
    return "".join(
        line for line in cert_pem.splitlines() if not line.startswith("-----") and line.strip()
    )


def _ecdsa_sign_raw(private_key: ec.EllipticCurvePrivateKey, message: bytes) -> bytes:
    der = private_key.sign(message, ec.ECDSA(hashes.SHA256()))
    r, s = decode_dss_signature(der)
    return r.to_bytes(32, "big") + s.to_bytes(32, "big")


def _double_encoded_digest(canonical_bytes: bytes) -> bytes:
    """SDK's quirk: digest -> hex string -> base64 of those hex ASCII bytes.

    Yields a 64-char hex string base64-encoded to an 88-char string.
    """
    h = hashlib.sha256(canonical_bytes).hexdigest()
    return base64.b64encode(h.encode("ascii"))


def _build_signed_properties(
    cert: x509.Certificate, signing_time: str
) -> etree._Element:
    """Construct <xades:SignedProperties> with the inner Cert/Issuer block."""
    nsmap = {"xades": NS["xades"], "ds": NS["ds"]}

    sp = etree.Element(f"{{{NS['xades']}}}SignedProperties", nsmap=nsmap)
    sp.set("Id", "xadesSignedProperties")

    ssp = etree.SubElement(sp, f"{{{NS['xades']}}}SignedSignatureProperties")
    st = etree.SubElement(ssp, f"{{{NS['xades']}}}SigningTime")
    st.text = signing_time

    sigcert = etree.SubElement(ssp, f"{{{NS['xades']}}}SigningCertificate")
    cert_el = etree.SubElement(sigcert, f"{{{NS['xades']}}}Cert")

    cd = etree.SubElement(cert_el, f"{{{NS['xades']}}}CertDigest")
    dm = etree.SubElement(cd, f"{{{NS['ds']}}}DigestMethod")
    dm.set("Algorithm", SHA256)
    dv = etree.SubElement(cd, f"{{{NS['ds']}}}DigestValue")
    dv.text = _double_encoded_digest(cert.public_bytes(serialization.Encoding.DER)).decode()

    issuer = etree.SubElement(cert_el, f"{{{NS['xades']}}}IssuerSerial")
    iname = etree.SubElement(issuer, f"{{{NS['ds']}}}X509IssuerName")
    iname.text = _bc_x500_string(cert.issuer)
    iserial = etree.SubElement(issuer, f"{{{NS['ds']}}}X509SerialNumber")
    iserial.text = str(cert.serial_number)

    return sp


def _build_signed_info(invoice_digest_b64: str, signed_props_digest_b64: str) -> etree._Element:
    nsmap = {"ds": NS["ds"]}
    si = etree.Element(f"{{{NS['ds']}}}SignedInfo", nsmap=nsmap)

    cm = etree.SubElement(si, f"{{{NS['ds']}}}CanonicalizationMethod")
    cm.set("Algorithm", C14N11)
    sm = etree.SubElement(si, f"{{{NS['ds']}}}SignatureMethod")
    sm.set("Algorithm", ECDSA_SHA256)

    r1 = etree.SubElement(si, f"{{{NS['ds']}}}Reference")
    r1.set("Id", "invoiceSignedData")
    r1.set("URI", "")
    transforms = etree.SubElement(r1, f"{{{NS['ds']}}}Transforms")
    for xp in (
        "not(//ancestor-or-self::ext:UBLExtensions)",
        "not(//ancestor-or-self::cac:Signature)",
        "not(//ancestor-or-self::cac:AdditionalDocumentReference[cbc:ID='QR'])",
    ):
        t = etree.SubElement(transforms, f"{{{NS['ds']}}}Transform")
        t.set("Algorithm", XPATH_REV)
        xpath = etree.SubElement(t, f"{{{NS['ds']}}}XPath")
        xpath.text = xp
    tc = etree.SubElement(transforms, f"{{{NS['ds']}}}Transform")
    tc.set("Algorithm", C14N11)
    dm = etree.SubElement(r1, f"{{{NS['ds']}}}DigestMethod")
    dm.set("Algorithm", SHA256)
    dv = etree.SubElement(r1, f"{{{NS['ds']}}}DigestValue")
    dv.text = invoice_digest_b64

    r2 = etree.SubElement(si, f"{{{NS['ds']}}}Reference")
    r2.set("Type", SIGPROPS_TYPE)
    r2.set("URI", "#xadesSignedProperties")
    dm2 = etree.SubElement(r2, f"{{{NS['ds']}}}DigestMethod")
    dm2.set("Algorithm", SHA256)
    dv2 = etree.SubElement(r2, f"{{{NS['ds']}}}DigestValue")
    dv2.text = signed_props_digest_b64

    return si


def _build_signature_block_skeleton(
    invoice_digest_b64: str,
    cert: x509.Certificate,
    cert_b64: str,
    signing_time: str,
) -> etree._Element:
    """Build the <ds:Signature> structure with placeholder digest and signature
    values. The actual SignedProperties digest and SignatureValue are filled in
    later, after the element is in its document context (so c14n11 includes the
    right namespace declarations).
    """
    sig_nsmap = {"ds": NS["ds"], "xades": NS["xades"]}
    sig = etree.Element(f"{{{NS['ds']}}}Signature", nsmap=sig_nsmap)
    sig.set("Id", "signature")

    # Placeholder SignedInfo with empty SignedProperties DigestValue.
    signed_info = _build_signed_info(invoice_digest_b64, "")
    sig.append(signed_info)

    # Placeholder SignatureValue.
    etree.SubElement(sig, f"{{{NS['ds']}}}SignatureValue")

    ki = etree.SubElement(sig, f"{{{NS['ds']}}}KeyInfo")
    x509data = etree.SubElement(ki, f"{{{NS['ds']}}}X509Data")
    x509cert = etree.SubElement(x509data, f"{{{NS['ds']}}}X509Certificate")
    x509cert.text = cert_b64

    obj = etree.SubElement(sig, f"{{{NS['ds']}}}Object")
    qp = etree.SubElement(obj, f"{{{NS['xades']}}}QualifyingProperties")
    qp.set("Target", "signature")
    qp.append(_build_signed_properties(cert, signing_time))

    return sig


def _wrap_in_ubl_extension(signature: etree._Element) -> etree._Element:
    """Build the full <ext:UBLExtensions> wrapper around the <ds:Signature>."""
    nsmap = {
        "ext": NS["ext"],
        "sig": NS["sig"],
        "sac": NS["sac"],
        "sbc": NS["sbc"],
        "cbc": NS["cbc"],
    }
    ubl_exts = etree.Element(f"{{{NS['ext']}}}UBLExtensions", nsmap=nsmap)
    ubl_ext = etree.SubElement(ubl_exts, f"{{{NS['ext']}}}UBLExtension")

    uri = etree.SubElement(ubl_ext, f"{{{NS['ext']}}}ExtensionURI")
    uri.text = EXT_URI

    content = etree.SubElement(ubl_ext, f"{{{NS['ext']}}}ExtensionContent")
    sigs = etree.SubElement(content, f"{{{NS['sig']}}}UBLDocumentSignatures")
    sig_info = etree.SubElement(sigs, f"{{{NS['sac']}}}SignatureInformation")

    id_el = etree.SubElement(sig_info, f"{{{NS['cbc']}}}ID")
    id_el.text = "urn:oasis:names:specification:ubl:signature:1"
    ref_id = etree.SubElement(sig_info, f"{{{NS['sbc']}}}ReferencedSignatureID")
    ref_id.text = "urn:oasis:names:specification:ubl:signature:Invoice"
    sig_info.append(signature)

    return ubl_exts


def sign_invoice(
    invoice_xml: bytes,
    private_key: ec.EllipticCurvePrivateKey,
    certificate_pem: str,
    signing_time: datetime | None = None,
) -> SignResult:
    """Produce the signed UBL bytes.

    Order matters: digests must be computed on the elements *in their final
    document context* so the namespace declarations c14n11 emits match what
    ZATCA's validator sees when it re-canonicalizes the same elements.

    1. Insert a skeleton Signature into the invoice.
    2. Canonicalize <xades:SignedProperties> in-context, compute its digest,
       fill the SignedInfo Reference DigestValue.
    3. Canonicalize <ds:SignedInfo> in-context, ECDSA-sign it, fill the
       SignatureValue.
    """
    cert = x509.load_pem_x509_certificate(certificate_pem.encode())
    cert_b64 = _strip_cert(certificate_pem)

    invoice_digest_b64 = compute_invoice_hash(invoice_xml)

    signing_time = signing_time or datetime.now(timezone.utc).replace(microsecond=0)
    signing_time_iso = signing_time.strftime("%Y-%m-%dT%H:%M:%S")

    signature = _build_signature_block_skeleton(
        invoice_digest_b64=invoice_digest_b64,
        cert=cert,
        cert_b64=cert_b64,
        signing_time=signing_time_iso,
    )
    ubl_extensions = _wrap_in_ubl_extension(signature)

    root = etree.fromstring(invoice_xml)
    root.insert(0, ubl_extensions)

    # SignedProperties digest (in-context canonicalization).
    sp_elem = root.xpath(".//xades:SignedProperties", namespaces=NS)[0]
    sp_canon = etree.tostring(sp_elem, method="c14n", exclusive=False, with_comments=False)
    sp_digest_b64 = _double_encoded_digest(sp_canon).decode()

    sp_ref_dv = root.xpath(
        ".//ds:Reference[@URI='#xadesSignedProperties']/ds:DigestValue",
        namespaces=NS,
    )[0]
    sp_ref_dv.text = sp_digest_b64

    # SignedInfo signature (in-context canonicalization).
    si_elem = root.xpath(".//ds:SignedInfo", namespaces=NS)[0]
    si_canon = etree.tostring(si_elem, method="c14n", exclusive=False, with_comments=False)
    sig_raw = _ecdsa_sign_raw(private_key, si_canon)
    sig_b64 = base64.b64encode(sig_raw).decode()

    sv_elem = root.xpath(".//ds:SignatureValue", namespaces=NS)[0]
    sv_elem.text = sig_b64

    signed = etree.tostring(root, xml_declaration=True, encoding="UTF-8")
    return SignResult(
        signed_xml=signed,
        invoice_hash_b64=invoice_digest_b64,
        signature_b64=sig_b64,
        cert_b64_no_headers=cert_b64,
    )


def cert_signature_b64(certificate_pem: str) -> str:
    """Extract the certificate's signature bytes — TLV tag 9 input for standard invoices."""
    cert = x509.load_pem_x509_certificate(certificate_pem.encode())
    return base64.b64encode(cert.signature).decode()


__all__ = [
    "SignResult",
    "sign_invoice",
    "cert_signature_b64",
]


# Defensive helpers — kept here so callers can sanity-check round-trips
def assert_hex_b64_roundtrip(double_encoded_b64: str) -> None:
    raw = base64.b64decode(double_encoded_b64).decode()
    binascii.unhexlify(raw)
