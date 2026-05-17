"""Invoice validation — replaces `fatoora -validate`.

Three layers:

1. XSD validation against UBL-Invoice-2.1.xsd.
2. CEN EN16931 schematron (CEN-EN16931-UBL.xsl).
3. ZATCA local rules (20210819_ZATCA_E-invoice_Validation_Rules.xsl).

Both schematrons ship as XSLT 2.0 stylesheets, which lxml can't run on its own;
we use Saxon-HE via the ``saxonche`` Python wheel — pure Python, no JVM.
"""
from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Literal

from lxml import etree

try:
    from saxonche import PySaxonProcessor
except ImportError:  # pragma: no cover — saxonche missing at install time
    PySaxonProcessor = None  # type: ignore[assignment]

from app.config import get_settings


@dataclass(frozen=True, slots=True)
class ValidationFailure:
    severity: Literal["fatal", "error", "warning"]
    rule: str
    message: str
    location: str | None = None


@dataclass(slots=True)
class ValidationReport:
    is_valid: bool
    xsd_failures: list[ValidationFailure]
    en16931_failures: list[ValidationFailure]
    zatca_failures: list[ValidationFailure]

    def summary(self) -> dict:
        return {
            "is_valid": self.is_valid,
            "xsd": [f.__dict__ for f in self.xsd_failures],
            "en16931": [f.__dict__ for f in self.en16931_failures],
            "zatca": [f.__dict__ for f in self.zatca_failures],
        }


@lru_cache(maxsize=1)
def _xsd_schema() -> etree.XMLSchema:
    path = (
        get_settings().assets_dir
        / "schemas"
        / "xsds"
        / "UBL2.1"
        / "xsd"
        / "maindoc"
        / "UBL-Invoice-2.1.xsd"
    )
    return etree.XMLSchema(etree.parse(str(path)))


@lru_cache(maxsize=2)
def _schematron_path(name: str) -> Path:
    return get_settings().assets_dir / "schematrons" / name


SVRL_NS = {"svrl": "http://purl.oclc.org/dsdl/svrl"}


def _parse_svrl(svrl_xml: str) -> list[ValidationFailure]:
    """Parse Schematron Validation Report Language output from saxon."""
    if not svrl_xml.strip():
        return []
    root = etree.fromstring(svrl_xml.encode())
    out: list[ValidationFailure] = []
    for el in root.xpath(".//svrl:failed-assert | .//svrl:successful-report", namespaces=SVRL_NS):
        flag = el.get("flag") or el.get("role") or "error"
        sev = "fatal" if flag.lower() in {"fatal", "warning-fatal"} else (
            "warning" if flag.lower().startswith("warn") else "error"
        )
        text_node = el.find("svrl:text", namespaces=SVRL_NS)
        msg = (text_node.text or "").strip() if text_node is not None else ""
        out.append(
            ValidationFailure(
                severity=sev,  # type: ignore[arg-type]
                rule=el.get("id") or el.get("test") or "",
                message=msg,
                location=el.get("location"),
            )
        )
    return out


def _run_schematron(xsl_filename: str, invoice_xml: bytes) -> list[ValidationFailure]:
    if PySaxonProcessor is None:
        return [ValidationFailure(
            severity="fatal",
            rule="saxonche_missing",
            message="saxonche is required to run schematron rules",
        )]
    xsl_path = _schematron_path(xsl_filename)
    with PySaxonProcessor(license=False) as proc:
        xslt = proc.new_xslt30_processor()
        executable = xslt.compile_stylesheet(stylesheet_file=str(xsl_path))
        result = executable.transform_to_string(source_text=invoice_xml.decode())
        return _parse_svrl(result or "")


def validate_invoice(invoice_xml: bytes) -> ValidationReport:
    parsed = etree.fromstring(invoice_xml)
    schema = _xsd_schema()

    xsd_failures: list[ValidationFailure] = []
    if not schema.validate(parsed):
        for err in schema.error_log:
            xsd_failures.append(
                ValidationFailure(
                    severity="error",
                    rule=f"xsd:{err.type_name}",
                    message=err.message,
                    location=f"line {err.line}",
                )
            )

    en16931_failures = _run_schematron("CEN-EN16931-UBL.xsl", invoice_xml)
    zatca_failures = _run_schematron("20210819_ZATCA_E-invoice_Validation_Rules.xsl", invoice_xml)

    fatal = any(
        f.severity in {"fatal", "error"}
        for bucket in (xsd_failures, en16931_failures, zatca_failures)
        for f in bucket
    )
    return ValidationReport(
        is_valid=not fatal,
        xsd_failures=xsd_failures,
        en16931_failures=en16931_failures,
        zatca_failures=zatca_failures,
    )
