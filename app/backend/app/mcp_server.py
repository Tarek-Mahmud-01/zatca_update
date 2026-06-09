"""ZATCA Phase-2 compliance testing MCP server.

Exposes ZATCA sandbox testing as MCP tools so an MCP client (Claude Desktop,
Claude Code, etc.) can drive the full compliance flow conversationally:

  * onboard()                 — fresh CCSID from ZATCA sandbox (OTP 123456)
  * test_invoice_type(type)   — build → sign → submit ONE of the 11 doc types
  * test_all_types()          — run all 11 and return a pass/fail table
  * compliance_set(bitmask)   — run the canonical demo set (6 or 12 invoices)
  * csid_status()             — show the session's cached CCSID

It is SELF-CONTAINED: it talks straight to ZATCA's developer-portal sandbox
using the project's own crypto pipeline (csr/keys/pipeline/client). It does
NOT need the FastAPI backend, Postgres, or Redis running — every tool obtains
a CCSID on demand and signs in-memory. State (CCSID + PIH chain) lives for the
life of the server process.

Run standalone (stdio transport):
    .venv\\Scripts\\python.exe -m app.mcp_server

Register with an MCP client by pointing it at that command.
"""
from __future__ import annotations

import base64
from dataclasses import dataclass, field
from datetime import date, datetime, time, timezone
from decimal import Decimal
from uuid import uuid4

import httpx
from mcp.server.fastmcp import FastMCP

from app.zatca.csr import CsrConfigInput, CsrTemplate, build_csr
from app.zatca.keys import generate_private_key, serialize_private_key_pem
from app.zatca.pipeline import process_invoice
from app.zatca.ubl_builder import (
    AdvancePaymentInvoice,
    ExportInvoice,
    InvoiceLine,
    MonetaryTotals,
    NominalSupplyInvoice,
    Party,
    SelfBillingInvoice,
    SimplifiedCreditNote,
    SimplifiedDebitNote,
    SimplifiedInvoice,
    StandardCreditNote,
    StandardDebitNote,
    StandardInvoice,
    SummaryInvoice,
    TaxCategoryCode,
    TaxSubtotal,
    _InvoiceBase,
)

ENV_BASE = {
    "sandbox": "https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal",
    "simulation": "https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation",
}
SANDBOX_BASE = ENV_BASE["sandbox"]  # back-compat default
SANDBOX_OTP = "123456"
GENESIS_PIH = (
    "NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ=="
)
_HEADERS = {
    "accept": "application/json",
    "Accept-Version": "V2",
    "Accept-Language": "en",
    "Content-Type": "application/json",
}

# The 11 doc types the platform supports.
DOC_CLASS = {
    "standard_invoice": StandardInvoice,
    "standard_credit_note": StandardCreditNote,
    "standard_debit_note": StandardDebitNote,
    "simplified_invoice": SimplifiedInvoice,
    "simplified_credit_note": SimplifiedCreditNote,
    "simplified_debit_note": SimplifiedDebitNote,
    "export_invoice": ExportInvoice,
    "summary_invoice": SummaryInvoice,
    "self_billing_invoice": SelfBillingInvoice,
    "advance_payment_invoice": AdvancePaymentInvoice,
    "nominal_supply_invoice": NominalSupplyInvoice,
}
ALL_DOC_TYPES = list(DOC_CLASS.keys())


# ---------------------------------------------------------------------------
# Session state — a CCSID + a per-doc-type PIH chain.
# ---------------------------------------------------------------------------


@dataclass
class Session:
    private_key_pem: str | None = None
    certificate_pem: str | None = None
    binary_security_token: str | None = None
    secret: str | None = None
    request_id: str | None = None
    org_id: str = "300025187600003"
    invoice_type: str = "1100"
    icv: int = 0
    prev_pih: str = GENESIS_PIH
    env: str = "sandbox"          # "sandbox" | "simulation"
    otp: str = SANDBOX_OTP        # sandbox uses 123456; simulation needs a real one
    # Most recent *invoice* (not note) submitted this session — used as the
    # default reference for make_credit_note / make_debit_note ("first search").
    last_invoice_number: str | None = None

    @property
    def base(self) -> str:
        return ENV_BASE.get(self.env, ENV_BASE["sandbox"])

    @property
    def template(self) -> "CsrTemplate":
        return CsrTemplate.simulation if self.env == "simulation" else CsrTemplate.sandbox

    @property
    def ready(self) -> bool:
        return bool(self.certificate_pem and self.binary_security_token and self.secret)


_S = Session()
mcp = FastMCP("zatca-compliance")


def _q(v) -> Decimal:
    from decimal import ROUND_HALF_UP
    return Decimal(str(v)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _now_time() -> time:
    n = datetime.now(timezone.utc)
    return time(n.hour, n.minute, n.second)


def _supplier() -> Party:
    return Party(
        registration_name="Al-Rukn Al-Hasan Trading Establishment",
        vat_number="300000000000003",
        crn=_S.org_id,
        street="Riyadh, Al-Naseem",
        building_number="0001",
        city_subdivision="District",
        city="Riyadh",
        postal_zone="00000",
        country_code="SA",
    )


def _b2b_customer() -> Party:
    return Party(
        registration_name="Compliance Test Buyer LTD",
        vat_number="399999999800003",
        street="Salah Al-Din", building_number="1111",
        city_subdivision="Al-Murooj", city="Riyadh",
        postal_zone="12222", country_code="SA",
    )


def _b2c_customer() -> Party:
    return Party(
        registration_name="Walk-in Customer",
        street="Walk-in", building_number="0",
        city_subdivision="N/A", city="Riyadh",
        postal_zone="00000", country_code="SA",
    )


def _foreign_customer() -> Party:
    return Party(
        registration_name="Global Import Co",
        street="5th Avenue", building_number="200",
        city_subdivision="Manhattan", city="New York",
        postal_zone="10001", country_code="US",
    )


def _basic_kw(supplier: Party, customer: Party, number: str) -> dict:
    line = InvoiceLine(
        id="1", name="Consulting services",
        quantity=Decimal("1"), unit_code="PCE", unit_price=Decimal("100.00"),
        line_extension=Decimal("100.00"), tax_amount=Decimal("15.00"),
        rounding_amount=Decimal("115.00"), tax_percent=Decimal("15"),
    )
    return dict(
        invoice_number=number, uuid=uuid4(),
        issue_date=date.today(), issue_time=_now_time(),
        icv=0, pih_b64="",
        supplier=supplier, customer=customer,
        lines=[line],
        tax_subtotals=[TaxSubtotal(taxable_amount=_q(100), tax_amount=_q(15))],
        monetary_totals=MonetaryTotals(
            line_extension=_q(100), tax_exclusive=_q(100),
            tax_inclusive=_q(115), payable_amount=_q(115),
        ),
        payment_means_code="10", notes=[],
    )


def _export_kw(supplier: Party, number: str) -> dict:
    """Export invoice — foreign buyer, zero-rated export of services."""
    line = InvoiceLine(
        id="1", name="Exported software license",
        quantity=Decimal("1"), unit_code="PCE", unit_price=Decimal("1000.00"),
        line_extension=Decimal("1000.00"), tax_amount=Decimal("0.00"),
        rounding_amount=Decimal("1000.00"),
        tax_category=TaxCategoryCode.zero_rated, tax_percent=Decimal("0"),
    )
    return dict(
        invoice_number=number, uuid=uuid4(),
        issue_date=date.today(), issue_time=_now_time(),
        icv=0, pih_b64="",
        supplier=supplier, customer=_foreign_customer(),
        lines=[line],
        tax_subtotals=[TaxSubtotal(
            taxable_amount=_q(1000), tax_amount=_q(0),
            tax_category=TaxCategoryCode.zero_rated, tax_percent=Decimal("0"),
            exemption_reason_code="VATEX-SA-32", exemption_reason="Export of services",
        )],
        monetary_totals=MonetaryTotals(
            line_extension=_q(1000), tax_exclusive=_q(1000),
            tax_inclusive=_q(1000), payable_amount=_q(1000),
        ),
        payment_means_code="10", notes=[],
    )


def _note_kw(base_kw: dict, ref: str, note: str) -> dict:
    kw = dict(base_kw)
    kw["billing_reference_id"] = ref
    kw["instruction_note"] = note
    return kw


def _build_payload(doc_type: str) -> _InvoiceBase:
    """Construct a sensible payload for any of the 11 doc types."""
    cls = DOC_CLASS[doc_type]
    is_b2c = doc_type.startswith("simplified") or doc_type in {
        "nominal_supply_invoice", "advance_payment_invoice",
    }
    supplier = _supplier()
    customer = _b2c_customer() if is_b2c else _b2b_customer()
    number = f"MCP-{doc_type[:6].upper()}-{_S.icv + 1:04d}"

    if doc_type == "export_invoice":
        kw = _export_kw(supplier, number)
    elif doc_type.endswith("credit_note"):
        kw = _note_kw(_basic_kw(supplier, customer, number), "MCP-REF-0001", "Partial refund")
    elif doc_type.endswith("debit_note"):
        kw = _note_kw(_basic_kw(supplier, customer, number), "MCP-REF-0001", "Additional charge")
    else:
        kw = _basic_kw(supplier, customer, number)
    return cls(**kw)


async def _ensure_ccsid() -> str | None:
    """Lazily obtain a sandbox CCSID. Returns an error string or None on success."""
    if _S.ready:
        return None
    cfg = CsrConfigInput(
        common_name="GuruERP-ARAH",
        serial_number="1-DTG|2-GuruERP|3-V320252",
        organization_identifier=_S.org_id,
        organization_unit_name="Al-Rukn Al-Hasan Trading Establishment",
        organization_name="Al-Rukn Al-Hasan Trading Establishment",
        country_name="SA",
        invoice_type=_S.invoice_type,
        location_address="Riyadh, Al-Naseem Al-Sharqi, Abdullah bin Suleim, 11689",
        industry_business_category="Trading",
    )
    key = generate_private_key()
    csr_pem = build_csr(cfg, key, _S.template)
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(
            f"{_S.base}/compliance",
            json={"csr": base64.b64encode(csr_pem.encode()).decode()},
            headers={**_HEADERS, "OTP": _S.otp},
        )
    if r.status_code != 200:
        return f"CCSID request failed: HTTP {r.status_code} {r.text[:200]}"
    body = r.json()
    token = body["binarySecurityToken"]
    _S.private_key_pem = serialize_private_key_pem(key)
    # The CCSID cert IS the binarySecurityToken (base64×2) — derive PEM.
    inner = base64.b64decode(token.strip()).decode().strip()
    der = base64.b64decode(inner)
    b64 = base64.b64encode(der).decode()
    wrapped = "\n".join(b64[i:i + 64] for i in range(0, len(b64), 64))
    _S.certificate_pem = f"-----BEGIN CERTIFICATE-----\n{wrapped}\n-----END CERTIFICATE-----\n"
    _S.binary_security_token = token
    _S.secret = body["secret"]
    _S.request_id = str(body.get("requestID") or "")
    return None


def _parse_date(s: str | None) -> date:
    """Parse a YYYY-MM-DD string, defaulting to today's date when empty/invalid."""
    if not s or not s.strip():
        return date.today()
    try:
        return date.fromisoformat(s.strip())
    except ValueError:
        return date.today()


def _custom_kw(
    supplier: Party, customer: Party, number: str, *,
    net: Decimal, description: str, issue_date: date,
) -> dict:
    """One-line payload kwargs for a given net (pre-VAT) amount at 15% VAT."""
    net = _q(net)
    vat = _q(net * Decimal("0.15"))
    total = _q(net + vat)
    line = InvoiceLine(
        id="1", name=description,
        quantity=Decimal("1"), unit_code="PCE", unit_price=net,
        line_extension=net, tax_amount=vat, rounding_amount=total,
        tax_percent=Decimal("15"),
    )
    return dict(
        invoice_number=number, uuid=uuid4(),
        issue_date=issue_date, issue_time=_now_time(),
        icv=0, pih_b64="",
        supplier=supplier, customer=customer,
        lines=[line],
        tax_subtotals=[TaxSubtotal(taxable_amount=net, tax_amount=vat)],
        monetary_totals=MonetaryTotals(
            line_extension=net, tax_exclusive=net,
            tax_inclusive=total, payable_amount=total,
        ),
        payment_means_code="10", notes=[],
    )


async def _sign_and_submit(payload: _InvoiceBase) -> dict:
    """Sign a built payload, advance the PIH chain, submit to /compliance/invoices,
    and record it as the session's last invoice (so notes can reference it)."""
    _S.icv += 1
    bound = payload.model_copy(update={"icv": _S.icv, "pih_b64": _S.prev_pih})
    processed = process_invoice(
        bound,
        private_key_pem=_S.private_key_pem,  # type: ignore[arg-type]
        certificate_pem=_S.certificate_pem,  # type: ignore[arg-type]
    )
    invoice_b64 = base64.b64encode(processed.signed_xml).decode()
    auth = base64.b64encode(f"{_S.binary_security_token}:{_S.secret}".encode()).decode()
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(
            f"{_S.base}/compliance/invoices",
            json={
                "invoiceHash": processed.invoice_hash_b64,
                "uuid": str(bound.uuid),
                "invoice": invoice_b64,
            },
            headers={**_HEADERS, "Authorization": f"Basic {auth}"},
        )
    _S.prev_pih = processed.invoice_hash_b64
    body = {}
    try:
        body = r.json()
    except Exception:
        pass
    vr = body.get("validationResults", {}) if isinstance(body, dict) else {}
    status = (
        body.get("clearanceStatus")
        or body.get("reportingStatus")
        or body.get("status")
        or ""
    ).upper() if isinstance(body, dict) else ""
    passed = 200 <= r.status_code < 300 and status in {"CLEARED", "REPORTED"}
    errors = [
        f"{e.get('code')}: {e.get('message')}"
        for e in (vr.get("errorMessages") or [])
    ]
    doc_type = getattr(bound, "doc_type", "")
    # Remember the latest plain invoice so credit/debit notes can auto-reference it.
    if passed and not doc_type.endswith("_note"):
        _S.last_invoice_number = bound.invoice_number
    return {
        "doc_type": doc_type,
        "icv": _S.icv,
        "invoice_number": bound.invoice_number,
        "http_status": r.status_code,
        "zatca_status": status or None,
        "passed": passed,
        "errors": errors[:5],
    }


async def _submit_one(doc_type: str) -> dict:
    """Build → sign → submit one default invoice of ``doc_type``."""
    return await _sign_and_submit(_build_payload(doc_type))


# ---------------------------------------------------------------------------
# MCP tools
# ---------------------------------------------------------------------------


@mcp.tool()
async def onboard(
    org_id: str = "300025187600003",
    invoice_type: str = "1100",
    env: str = "sandbox",
    otp: str = "",
) -> dict:
    """Obtain a fresh ZATCA Compliance CSID (CCSID) for the session.

    env="sandbox" (default) uses the fixed test OTP 123456 — no portal visit.
    env="simulation" requires a REAL OTP generated at https://fatoora.zatca.gov.sa
    for this org_id (pass it via the `otp` arg); 123456 will be rejected with
    Invalid-OTP. The CCSID is cached for subsequent test_* calls.
    """
    if env not in ENV_BASE:
        return {"ok": False, "error": f"env must be one of {list(ENV_BASE)}"}
    _S.org_id = org_id
    _S.invoice_type = invoice_type
    _S.env = env
    _S.otp = otp or (SANDBOX_OTP if env == "sandbox" else "")
    if env == "simulation" and not _S.otp:
        return {"ok": False, "error": "simulation requires a real `otp` from fatoora.zatca.gov.sa"}
    # Reset chain + force re-onboard with the new params.
    _S.certificate_pem = None
    _S.icv = 0
    _S.prev_pih = GENESIS_PIH
    _S.last_invoice_number = None
    err = await _ensure_ccsid()
    if err:
        return {"ok": False, "error": err, "env": env}
    return {
        "ok": True,
        "env": env,
        "request_id": _S.request_id,
        "org_id": _S.org_id,
        "invoice_type": _S.invoice_type,
        "cert_pem_len": len(_S.certificate_pem or ""),
        "message": f"CCSID issued for {env}. Ready to test invoice types.",
    }


@mcp.tool()
async def test_invoice_type(doc_type: str) -> dict:
    """Build, sign, and submit ONE invoice of the given doc_type to ZATCA
    sandbox compliance, returning the exact validation outcome.

    doc_type must be one of: standard_invoice, standard_credit_note,
    standard_debit_note, simplified_invoice, simplified_credit_note,
    simplified_debit_note, export_invoice, summary_invoice,
    self_billing_invoice, advance_payment_invoice, nominal_supply_invoice.
    """
    if doc_type not in DOC_CLASS:
        return {"ok": False, "error": f"unknown doc_type {doc_type!r}", "valid_types": ALL_DOC_TYPES}
    err = await _ensure_ccsid()
    if err:
        return {"ok": False, "error": err}
    result = await _submit_one(doc_type)
    return {"ok": True, **result}


@mcp.tool()
async def make_invoice(
    amount: float = 100.0,
    description: str = "Consulting services",
    simplified: bool = True,
    customer_name: str = "",
    vat_number: str = "",
    issue_date: str = "",
) -> dict:
    """Create, sign, and submit a tax invoice to ZATCA.

    amount is the net (pre-VAT) line total; 15% VAT is added automatically.
    simplified=True → B2C simplified invoice (walk-in customer); False → B2B
    standard invoice (pass customer_name + vat_number, or a default B2B buyer is
    used). issue_date defaults to today (YYYY-MM-DD to override). The resulting
    invoice number becomes the default reference for make_credit_note / _debit_note.
    """
    err = await _ensure_ccsid()
    if err:
        return {"ok": False, "error": err}
    supplier = _supplier()
    if simplified:
        customer = _b2c_customer()
        cls = SimplifiedInvoice
    else:
        cls = StandardInvoice
        customer = (
            Party(
                registration_name=customer_name, vat_number=(vat_number or None),
                street="N/A", building_number="0", city_subdivision="N/A",
                city="Riyadh", postal_zone="00000", country_code="SA",
            )
            if customer_name else _b2b_customer()
        )
    number = f"MCP-INV-{_S.icv + 1:04d}"
    payload = cls(**_custom_kw(
        supplier, customer, number,
        net=Decimal(str(amount)), description=description, issue_date=_parse_date(issue_date),
    ))
    return {"ok": True, **await _sign_and_submit(payload)}


async def _make_note(
    *, is_credit: bool, amount: float, reason: str, reference: str,
    reason_code: str, simplified: bool, description: str, issue_date: str,
) -> dict:
    err = await _ensure_ccsid()
    if err:
        return {"ok": False, "error": err}
    if not (reason.strip() or reason_code.strip()):
        return {"ok": False, "error": "a reason (or reason_code) is required — ZATCA rule BR-KSA-17"}
    # "First search" for the original invoice to reference: explicit arg wins,
    # else fall back to the most recent invoice created this session.
    ref = reference.strip() or (_S.last_invoice_number or "")
    if not ref:
        return {
            "ok": False,
            "error": "no reference invoice — pass `reference=<invoice number>` or call make_invoice first",
        }
    kind = "credit_note" if is_credit else "debit_note"
    cls = (SimplifiedCreditNote if is_credit else SimplifiedDebitNote) if simplified \
        else (StandardCreditNote if is_credit else StandardDebitNote)
    supplier = _supplier()
    customer = _b2c_customer() if simplified else _b2b_customer()
    number = f"MCP-{'CN' if is_credit else 'DN'}-{_S.icv + 1:04d}"
    desc = description or (("Refund — " if is_credit else "Additional charge — ") + (reason or reason_code))
    kw = _custom_kw(
        supplier, customer, number,
        net=Decimal(str(amount)), description=desc, issue_date=_parse_date(issue_date),
    )
    kw["billing_reference_id"] = ref
    if reason_code.strip():
        kw["instruction_code"] = reason_code.strip()
    if reason.strip():
        kw["instruction_note"] = reason.strip()
    payload = cls(**kw)
    res = await _sign_and_submit(payload)
    return {"ok": True, "note_kind": kind, "references": ref, **res}


@mcp.tool()
async def make_credit_note(
    amount: float = 100.0,
    reason: str = "",
    reference: str = "",
    reason_code: str = "",
    simplified: bool = True,
    description: str = "",
    issue_date: str = "",
) -> dict:
    """Create, sign, and submit a CREDIT note (reduction/refund) to ZATCA.

    A credit/debit note must reference the original invoice and carry a reason
    (BR-KSA-17). `reference` is the original invoice number — if omitted, the most
    recent invoice created this session is used. Provide `reason` (free text)
    and/or `reason_code` (e.g. CANCELLATION_OR_TERMINATION); at least one is
    required. issue_date defaults to today.
    """
    return await _make_note(
        is_credit=True, amount=amount, reason=reason, reference=reference,
        reason_code=reason_code, simplified=simplified, description=description,
        issue_date=issue_date,
    )


@mcp.tool()
async def make_debit_note(
    amount: float = 100.0,
    reason: str = "",
    reference: str = "",
    reason_code: str = "",
    simplified: bool = True,
    description: str = "",
    issue_date: str = "",
) -> dict:
    """Create, sign, and submit a DEBIT note (additional charge) to ZATCA.

    Same rules as make_credit_note: references the original invoice (defaults to
    the most recent invoice this session) and requires a reason and/or
    reason_code (BR-KSA-17). issue_date defaults to today.
    """
    return await _make_note(
        is_credit=False, amount=amount, reason=reason, reference=reference,
        reason_code=reason_code, simplified=simplified, description=description,
        issue_date=issue_date,
    )


@mcp.tool()
async def test_all_types() -> dict:
    """Run every one of the 11 invoice doc types through ZATCA sandbox
    compliance and return a pass/fail summary plus per-type detail.
    """
    err = await _ensure_ccsid()
    if err:
        return {"ok": False, "error": err}
    results = []
    for dt in ALL_DOC_TYPES:
        try:
            results.append(await _submit_one(dt))
        except Exception as e:  # noqa: BLE001
            results.append({"doc_type": dt, "passed": False, "errors": [f"exception: {e}"]})
    passed = sum(1 for r in results if r.get("passed"))
    return {
        "ok": True,
        "total": len(results),
        "passed": passed,
        "failed": len(results) - passed,
        "results": results,
    }


@mcp.tool()
async def compliance_set(invoice_type: str = "1100") -> dict:
    """Run the canonical ZATCA compliance demo set for the given bitmask.

    1100 = Standard + Simplified (12 invoices), 1000 = Standard only (6),
    0100 = Simplified only (6). This mirrors what real onboarding submits
    before production promotion.
    """
    from app.zatca.demo import scenarios_for_invoice_type

    _S.invoice_type = invoice_type
    _S.certificate_pem = None  # re-onboard with this bitmask
    err = await _ensure_ccsid()
    if err:
        return {"ok": False, "error": err}
    try:
        scenarios = scenarios_for_invoice_type(invoice_type)
    except ValueError as e:
        return {"ok": False, "error": str(e)}
    results = []
    for _scenario, doc_type in scenarios:
        results.append(await _submit_one(doc_type))
    passed = sum(1 for r in results if r.get("passed"))
    return {
        "ok": True,
        "invoice_type": invoice_type,
        "total": len(results),
        "passed": passed,
        "all_passed": passed == len(results),
        "results": results,
    }


@mcp.tool()
def csid_status() -> dict:
    """Show the session's cached CCSID state (no network call)."""
    return {
        "ready": _S.ready,
        "org_id": _S.org_id,
        "invoice_type": _S.invoice_type,
        "request_id": _S.request_id,
        "icv_counter": _S.icv,
        "cert_pem_len": len(_S.certificate_pem or ""),
    }


@mcp.tool()
def list_doc_types() -> dict:
    """List the 11 invoice doc types this server can test."""
    return {"doc_types": ALL_DOC_TYPES, "count": len(ALL_DOC_TYPES)}


if __name__ == "__main__":
    mcp.run()
