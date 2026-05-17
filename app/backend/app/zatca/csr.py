"""CSR generation — replaces `fatoora -csr -csrConfig ...`.

ZATCA requires four custom extensions on the CSR (see SDK source + ZATCA dev portal manual):

1. customCertExtension 1.3.6.1.4.1.311.20.2 — Microsoft template name
     - TST sandbox/simulation: "TSTZATCA-Code-Signing"
     - Production:             "PRZATCA-Code-Signing"
2. SubjectAltName with a directoryName carrying:
     - SN (serial number)              = csr.serial.number  (format "1-...|2-...|3-...")
     - UID (organization identifier)   = 15-digit VAT-derived ID
     - title                            = invoice_type (4 digits e.g. 1100)
     - registeredAddress                = csr.location.address
     - businessCategory                 = csr.industry.business.category
3. Subject DN with CN, O, OU, C.
4. EC public key (secp256k1) — already handled by keys.py.

Output is a CSR in PEM (or base64-no-headers when ``pem=False``), exactly as ZATCA's
`/compliance` endpoint accepts.
"""
from __future__ import annotations

import base64
from enum import Enum

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID
from pydantic import BaseModel, Field


CUSTOM_TEMPLATE_OID = x509.ObjectIdentifier("1.3.6.1.4.1.311.20.2")


class CsrTemplate(str, Enum):
    """Microsoft cert template name embedded in the CSR (OID 1.3.6.1.4.1.311.20.2).

    Verified against the SDK's openssl_temp.cnf and ZATCA's published examples:
        sandbox    -> TSTZATCA-Code-Signing
        simulation -> PREZATCA-Code-Signing
        production -> ZATCA-Code-Signing
    """

    sandbox = "TSTZATCA-Code-Signing"
    simulation = "PREZATCA-Code-Signing"
    production = "ZATCA-Code-Signing"


class CsrConfigInput(BaseModel):
    """Mirrors csr-config-template.properties from the SDK."""

    common_name: str
    serial_number: str = Field(description="Format: 1-{solution}|2-{model}|3-{uuid}")
    organization_identifier: str = Field(min_length=15, max_length=15)
    organization_unit_name: str
    organization_name: str
    country_name: str = "SA"
    invoice_type: str = Field(default="1100", pattern=r"^[01]{4}$")
    location_address: str
    industry_business_category: str


def _build_san_directory(cfg: CsrConfigInput) -> x509.SubjectAlternativeName:
    """SAN with a directoryName the way ZATCA expects.

    Order and OIDs of RDNs must match what ZATCA's PKI validates against — verified
    against the issued cert in Data/Input/cert.pem:

        2.5.4.4   surname           -> serial_number    (ZATCA repurposes this OID)
        0.9.2342.19200300.100.1.1   -> organization_identifier
        2.5.4.12  title             -> invoice_type
        2.5.4.26  registeredAddress -> location_address
        2.5.4.15  businessCategory  -> industry_business_category

    Note that ZATCA uses 2.5.4.4 (surname) and NOT 2.5.4.5 (serialNumber) for the
    serial. NameOID.SERIAL_NUMBER in cryptography is 2.5.4.5 — using it caused
    ZATCA's API to reject our CSRs with "Invalid-CSR".
    """
    SURNAME_OID = x509.ObjectIdentifier("2.5.4.4")
    REGISTERED_ADDRESS_OID = x509.ObjectIdentifier("2.5.4.26")
    rdns = x509.Name(
        [
            x509.NameAttribute(SURNAME_OID, cfg.serial_number),
            x509.NameAttribute(NameOID.USER_ID, cfg.organization_identifier),
            x509.NameAttribute(NameOID.TITLE, cfg.invoice_type),
            x509.NameAttribute(REGISTERED_ADDRESS_OID, cfg.location_address),
            x509.NameAttribute(NameOID.BUSINESS_CATEGORY, cfg.industry_business_category),
        ]
    )
    return x509.SubjectAlternativeName([x509.DirectoryName(rdns)])


def _template_extension(template: CsrTemplate) -> x509.UnrecognizedExtension:
    """customCertExtension with the Microsoft template name as a PrintableString.

    Matches the SDK's openssl_temp.cnf:
        zatcaTemplate = ASN1:PRINTABLESTRING:<TemplateName>

    PrintableString tag is 0x13 followed by short-form length and ASCII bytes.
    """
    name_bytes = template.value.encode("ascii")
    body = bytes([0x13, len(name_bytes)]) + name_bytes
    return x509.UnrecognizedExtension(CUSTOM_TEMPLATE_OID, body)


def build_csr(
    cfg: CsrConfigInput,
    private_key: ec.EllipticCurvePrivateKey,
    template: CsrTemplate,
    *,
    pem: bool = True,
) -> str:
    """Build a CSR matching the SDK's openssl_temp.cnf recipe.

    Critical details (don't change without re-verifying against ZATCA simulation):
      * Subject DN order: C, OU, O, CN  — RFC4514 prints reverse, but the DER
        encoding ZATCA validates against must start with C.
      * keyUsage = digitalSignature, nonRepudiation, keyEncipherment
      * basicConstraints CA:FALSE
      * SAN with directoryName (SN, UID, title, registeredAddress, businessCategory)
      * customCertExtension 1.3.6.1.4.1.311.20.2 as PrintableString
    """
    subject = x509.Name(
        [
            x509.NameAttribute(NameOID.COUNTRY_NAME, cfg.country_name),
            x509.NameAttribute(NameOID.ORGANIZATIONAL_UNIT_NAME, cfg.organization_unit_name),
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, cfg.organization_name),
            x509.NameAttribute(NameOID.COMMON_NAME, cfg.common_name),
        ]
    )

    template_ext = _template_extension(template)
    san_ext = _build_san_directory(cfg)

    builder = (
        x509.CertificateSigningRequestBuilder()
        .subject_name(subject)
        .add_extension(
            x509.BasicConstraints(ca=False, path_length=None), critical=False
        )
        .add_extension(
            x509.KeyUsage(
                digital_signature=True,
                content_commitment=True,  # = nonRepudiation
                key_encipherment=True,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=False,
                crl_sign=False,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=False,
        )
        .add_extension(san_ext, critical=False)
        .add_extension(template_ext, critical=False)
    )

    csr = builder.sign(private_key, hashes.SHA256())
    pem_bytes = csr.public_bytes(serialization.Encoding.PEM)

    if pem:
        return pem_bytes.decode()

    body = "".join(
        line for line in pem_bytes.decode().splitlines()
        if not line.startswith("-----") and line.strip()
    )
    return body


def csr_to_base64_payload(csr_pem: str) -> str:
    """ZATCA `/compliance` body wants the CSR base64-encoded once more (whole PEM)."""
    return base64.b64encode(csr_pem.encode()).decode()
