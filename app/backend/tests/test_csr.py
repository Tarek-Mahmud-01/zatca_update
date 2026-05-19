"""ZATCA CSR conformance tests.

We don't byte-compare against the SDK (ECDSA signatures are non-deterministic), so
we instead assert every structural requirement ZATCA's PKI cares about:

  * Subject DN order: C, OU, O, CN (matches SDK's openssl_temp.cnf)
  * Public key on curve secp256k1
  * Template extension (1.3.6.1.4.1.311.20.2) as PrintableString containing the
    correct template name per environment
  * SAN with directoryName containing:
      2.5.4.4   surname            (serial_number; NOT 2.5.4.5)
      0.9.2342.19200300.100.1.1   (organization_identifier)
      2.5.4.12  title              (invoice_type)
      2.5.4.26  registeredAddress  (location_address)
      2.5.4.15  businessCategory   (industry_business_category)
  * basicConstraints CA:FALSE
  * keyUsage = digitalSignature, nonRepudiation, keyEncipherment
"""
import pytest
from cryptography import x509
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import ExtensionOID, NameOID

from app.zatca.csr import CsrConfigInput, CsrTemplate, build_csr
from app.zatca.keys import generate_private_key

TEMPLATE_OID = "1.3.6.1.4.1.311.20.2"
SURNAME_OID = "2.5.4.4"
USER_ID_OID = "0.9.2342.19200300.100.1.1"
TITLE_OID = "2.5.4.12"
REGISTERED_ADDRESS_OID = "2.5.4.26"
BUSINESS_CATEGORY_OID = "2.5.4.15"


def _sample_config() -> CsrConfigInput:
    return CsrConfigInput(
        common_name="TST-886431145-399999999900003",
        serial_number="1-TST|2-TST|3-ed22f1d8-e6a2-1118-9b58-d9a8f11e445f",
        organization_identifier="399999999900003",
        organization_unit_name="Riyadh Branch",
        organization_name="Maximum Speed Tech Supply LTD",
        invoice_type="1100",
        location_address="RRRD2929",
        industry_business_category="Supply activities",
    )


def _build(template: CsrTemplate = CsrTemplate.sandbox) -> tuple[x509.CertificateSigningRequest, ec.EllipticCurvePrivateKey]:
    key = generate_private_key()
    pem = build_csr(_sample_config(), key, template, pem=True)
    return x509.load_pem_x509_csr(pem.encode()), key


def test_public_key_is_secp256k1() -> None:
    csr, _ = _build()
    pk = csr.public_key()
    assert isinstance(pk, ec.EllipticCurvePublicKey)
    assert isinstance(pk.curve, ec.SECP256K1)


def test_subject_dn_order_is_C_O_OU_CN() -> None:
    """The DER-encoded subject is C → O → OU → CN — matches the order
    in ZATCA-issued certs (verified against Data/Input/cert.pem) and what
    BouncyCastle's BCStyle (used by the ZATCA SDK) emits.
    """
    csr, _ = _build()
    oids = [a.oid.dotted_string for a in csr.subject]
    assert oids == [
        NameOID.COUNTRY_NAME.dotted_string,
        NameOID.ORGANIZATION_NAME.dotted_string,
        NameOID.ORGANIZATIONAL_UNIT_NAME.dotted_string,
        NameOID.COMMON_NAME.dotted_string,
    ]


def test_subject_dn_attributes_are_printable_string() -> None:
    """ZATCA's PKI rejects CSRs whose subject attributes are UTF8String —
    verified empirically. BouncyCastle's BCStyle emits PrintableString for
    ASCII-safe values, and ZATCA-issued certs use PrintableString too.
    """
    import base64
    csr_pem = build_csr(_sample_config(), generate_private_key(), CsrTemplate.sandbox, pem=True)
    body = "".join(
        line for line in csr_pem.splitlines()
        if not line.startswith("-----") and line.strip()
    )
    der = base64.b64decode(body)
    cfg = _sample_config()
    for value in (cfg.country_name, cfg.organization_name, cfg.organization_unit_name, cfg.common_name):
        idx = der.find(value.encode("ascii"))
        assert idx > 0, f"value {value!r} not found in DER"
        # Two bytes before the value: tag, length. Tag 0x13 = PrintableString.
        assert der[idx - 2] == 0x13, (
            f"attribute {value!r} encoded as tag={hex(der[idx-2])}, expected "
            f"PrintableString (0x13) — ZATCA rejects UTF8String here."
        )


def test_subject_dn_values() -> None:
    csr, _ = _build()
    cfg = _sample_config()
    by_oid = {a.oid.dotted_string: a.value for a in csr.subject}
    assert by_oid[NameOID.COUNTRY_NAME.dotted_string] == cfg.country_name
    assert by_oid[NameOID.ORGANIZATIONAL_UNIT_NAME.dotted_string] == cfg.organization_unit_name
    assert by_oid[NameOID.ORGANIZATION_NAME.dotted_string] == cfg.organization_name
    assert by_oid[NameOID.COMMON_NAME.dotted_string] == cfg.common_name


def test_san_has_directoryname_with_correct_oids_and_values() -> None:
    csr, _ = _build()
    cfg = _sample_config()
    san = csr.extensions.get_extension_for_oid(ExtensionOID.SUBJECT_ALTERNATIVE_NAME).value
    dirs = [n for n in san if isinstance(n, x509.DirectoryName)]
    assert len(dirs) == 1, "expected exactly one DirectoryName entry in SAN"

    rdn_pairs = [(rdn.oid.dotted_string, rdn.value) for rdn in dirs[0].value]
    assert dict(rdn_pairs) == {
        SURNAME_OID: cfg.serial_number,
        USER_ID_OID: cfg.organization_identifier,
        TITLE_OID: cfg.invoice_type,
        REGISTERED_ADDRESS_OID: cfg.location_address,
        BUSINESS_CATEGORY_OID: cfg.industry_business_category,
    }


def test_san_uses_surname_oid_not_serialnumber_oid() -> None:
    """Regression test for the bug that caused ZATCA to reject all our CSRs.

    ZATCA repurposes 2.5.4.4 (surname) for serial_number. We must NOT use
    2.5.4.5 (the real serialNumber OID).
    """
    csr, _ = _build()
    san = csr.extensions.get_extension_for_oid(ExtensionOID.SUBJECT_ALTERNATIVE_NAME).value
    dirs = [n for n in san if isinstance(n, x509.DirectoryName)]
    rdn_oids = {rdn.oid.dotted_string for rdn in dirs[0].value}
    assert SURNAME_OID in rdn_oids
    assert NameOID.SERIAL_NUMBER.dotted_string not in rdn_oids, (
        "must use 2.5.4.4 (surname), not 2.5.4.5 (serialNumber)"
    )


def test_basic_constraints_ca_false() -> None:
    csr, _ = _build()
    bc = csr.extensions.get_extension_for_oid(ExtensionOID.BASIC_CONSTRAINTS).value
    assert bc.ca is False


def test_key_usage_is_digitalsig_nonrepud_keyencipherment() -> None:
    csr, _ = _build()
    ku = csr.extensions.get_extension_for_oid(ExtensionOID.KEY_USAGE).value
    assert ku.digital_signature is True
    assert ku.content_commitment is True  # nonRepudiation
    assert ku.key_encipherment is True
    assert ku.data_encipherment is False
    assert ku.key_agreement is False
    assert ku.key_cert_sign is False
    assert ku.crl_sign is False


@pytest.mark.parametrize(
    "template,expected",
    [
        (CsrTemplate.sandbox,    "TSTZATCA-Code-Signing"),
        (CsrTemplate.simulation, "PREZATCA-Code-Signing"),
        (CsrTemplate.production, "ZATCA-Code-Signing"),
    ],
)
def test_template_extension_is_printablestring_with_correct_name(
    template: CsrTemplate, expected: str
) -> None:
    """OID 1.3.6.1.4.1.311.20.2 must contain a PrintableString (tag 0x13)
    whose body is the env-specific template name.

    The SDK's openssl_temp.cnf is the canonical reference:
        zatcaTemplate = ASN1:PRINTABLESTRING:<Name>
    """
    csr, _ = _build(template)
    ext = next(e for e in csr.extensions if e.oid.dotted_string == TEMPLATE_OID)
    raw = ext.value.value
    assert raw[0] == 0x13, f"expected PrintableString tag 0x13, got 0x{raw[0]:02x}"
    assert raw[1] == len(expected), "DER length byte must match expected name length"
    assert raw[2:].decode("ascii") == expected


def test_csr_signs_with_sha256_ecdsa() -> None:
    csr, _ = _build()
    assert csr.signature_hash_algorithm is not None
    assert csr.signature_hash_algorithm.name == "sha256"


def test_csr_pem_round_trip_through_pem_off_mode() -> None:
    """pem=False returns headerless base64 body — must still be loadable as a CSR
    once we wrap it back with PEM headers."""
    key = generate_private_key()
    body = build_csr(_sample_config(), key, CsrTemplate.sandbox, pem=False)
    assert "-----" not in body
    pem = "-----BEGIN CERTIFICATE REQUEST-----\n" + body + "\n-----END CERTIFICATE REQUEST-----\n"
    csr = x509.load_pem_x509_csr(pem.encode())
    assert csr.subject is not None
