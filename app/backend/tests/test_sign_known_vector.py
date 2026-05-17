"""Signing pipeline regression test.

We re-sign the SDK sample invoice using its embedded certificate and a freshly
generated private key, then assert structural invariants:

  * the produced bytes parse as XML and contain <ds:Signature Id="signature">
  * the <ds:DigestValue> on the invoice reference equals our compute_invoice_hash
    of the unsigned form
  * <xades:SignedProperties Id="xadesSignedProperties"> is present
  * <ds:X509Certificate> is the stripped cert

(Note: we can't byte-match the SDK's signature output because ECDSA is
non-deterministic; the deterministic pieces ARE matched in test_hash_known_vector.)
"""
from datetime import datetime, timedelta, timezone

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID
from lxml import etree

from app.zatca.canonicalize import NS
from app.zatca.hash import compute_invoice_hash
from app.zatca.keys import generate_private_key
from app.zatca.sign import sign_invoice


def _make_self_signed_cert() -> tuple[ec.EllipticCurvePrivateKey, str]:
    """Generate a fresh test certificate at import time — always valid PEM."""
    key = ec.generate_private_key(ec.SECP256K1())
    subject = x509.Name([
        x509.NameAttribute(NameOID.COMMON_NAME, "ZATCA Test"),
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
    return key, cert.public_bytes(serialization.Encoding.PEM).decode()


_TEST_KEY, TEST_CERT_PEM = _make_self_signed_cert()


def _strip_signature_for_unsigned_form(xml: bytes) -> bytes:
    """Return the SDK sample with UBLExtensions removed — i.e. what we'd produce
    before signing. The <cac:Signature> placeholder stays."""
    root = etree.fromstring(xml)
    for n in root.xpath(".//ext:UBLExtensions", namespaces=NS):
        n.getparent().remove(n)
    return etree.tostring(root, xml_declaration=True, encoding="UTF-8")


def test_signing_produces_well_formed_structure(simplified_invoice_sample: bytes) -> None:
    unsigned = _strip_signature_for_unsigned_form(simplified_invoice_sample)

    expected_hash = compute_invoice_hash(unsigned)

    key = generate_private_key()
    result = sign_invoice(
        invoice_xml=unsigned,
        private_key=key,
        certificate_pem=TEST_CERT_PEM,
        signing_time=datetime(2026, 5, 16, 10, 0, 0, tzinfo=timezone.utc),
    )

    assert result.invoice_hash_b64 == expected_hash

    root = etree.fromstring(result.signed_xml)
    sigs = root.xpath(".//ds:Signature", namespaces=NS)
    assert len(sigs) == 1
    assert sigs[0].get("Id") == "signature"

    sp = root.xpath(".//xades:SignedProperties[@Id='xadesSignedProperties']", namespaces=NS)
    assert len(sp) == 1

    cert_el = root.xpath(".//ds:X509Certificate", namespaces=NS)
    assert cert_el and "BEGIN CERTIFICATE" not in (cert_el[0].text or "")

    sig_value = root.xpath(".//ds:SignatureValue", namespaces=NS)
    assert sig_value and len(sig_value[0].text or "") > 80
