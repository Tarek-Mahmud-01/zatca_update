"""Onboarding routes: CSR → CCSID → compliance demo invoices → PCSID."""
from __future__ import annotations

import base64
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select

from app.config import ZatcaEnv
from app.db.models import Csid, CsrConfig, Tenant
from app.deps import CurrentUserDep, DbSession
from app.zatca.client import ZatcaClient
from app.zatca.csr import CsrConfigInput, CsrTemplate, build_csr
from app.zatca.demo import build_compliance_demo_set, scenarios_for_invoice_type
from app.zatca.keys import generate_private_key, serialize_private_key_pem
from app.zatca.pipeline import process_invoice

router = APIRouter(prefix="/onboarding", tags=["onboarding"])


def _extract_error_messages(resp) -> str:
    """Pull the blocking errorMessages out of a ZATCA validation response.

    ZATCA's body has validationResults.{errorMessages, warningMessages}.
    Warnings (e.g. BR-KSA-F-08 about CRN) don't block clearance — the real
    rejection reason lives in errorMessages, which the old [:500] truncation
    was cutting off. Return a compact 'code: message' list of the errors;
    fall back to raw text if the shape is unexpected.
    """
    try:
        vr = (resp.body or {}).get("validationResults") or {}
        errors = vr.get("errorMessages") or []
        if errors:
            return " | ".join(
                f"{e.get('code', '?')}: {e.get('message', '')}".strip()
                for e in errors
            )[:2000]
        # No explicit errors but still not cleared — surface warnings so the
        # user has something actionable.
        warnings = vr.get("warningMessages") or []
        if warnings:
            return "WARNINGS — " + " | ".join(
                f"{w.get('code', '?')}: {w.get('message', '')}".strip()
                for w in warnings
            )[:2000]
    except Exception:
        pass
    return (resp.raw_text or "")[:2000]


def _binary_token_to_pem(token: str) -> str | None:
    """ZATCA's compliance/production response delivers the X.509 certificate
    AS the `binarySecurityToken` — there is no separate `certificate` field.

    The token is base64-encoded twice: decoding once yields the inner base64
    of the DER certificate. We decode to raw DER, then re-wrap as PEM so the
    rest of the pipeline (signing, QR) has a normal certificate.

    Mirrors the working reference's write_certificate_pem(). Returns None if
    the token is empty or can't be decoded.
    """
    if not token:
        return None
    try:
        inner = base64.b64decode(token.strip()).decode().strip()  # inner = base64(DER)
        der = base64.b64decode(inner)                              # raw DER
        b64 = base64.b64encode(der).decode()
        wrapped = "\n".join(b64[i : i + 64] for i in range(0, len(b64), 64))
        return f"-----BEGIN CERTIFICATE-----\n{wrapped}\n-----END CERTIFICATE-----\n"
    except Exception:
        return None


def _template_for(env: ZatcaEnv) -> CsrTemplate:
    return {
        ZatcaEnv.sandbox: CsrTemplate.sandbox,
        ZatcaEnv.simulation: CsrTemplate.simulation,
        ZatcaEnv.production: CsrTemplate.production,
    }[env]


# ---------------------------------------------------------------------------
# 1. CSR
# ---------------------------------------------------------------------------


class CsrRequest(BaseModel):
    env: ZatcaEnv
    config: CsrConfigInput


class CsrResponse(BaseModel):
    csid_id: UUID
    csr_pem: str


@router.post("/csr", response_model=CsrResponse)
async def generate_csr(
    req: CsrRequest, user: CurrentUserDep, db: DbSession
) -> CsrResponse:
    cfg_row = CsrConfig(
        tenant_id=user.tenant_id,
        env=req.env.value,
        common_name=req.config.common_name,
        serial_number=req.config.serial_number,
        organization_identifier=req.config.organization_identifier,
        organization_unit_name=req.config.organization_unit_name,
        organization_name=req.config.organization_name,
        country_name=req.config.country_name,
        invoice_type=req.config.invoice_type,
        location_address=req.config.location_address,
        industry_business_category=req.config.industry_business_category,
    )
    db.add(cfg_row)

    key = generate_private_key()
    csr_pem = build_csr(req.config, key, _template_for(req.env), pem=True)

    csid = Csid(
        tenant_id=user.tenant_id,
        env=req.env.value,
        kind="compliance",
        private_key_pem=serialize_private_key_pem(key),
        csr_pem=csr_pem,
    )
    db.add(csid)
    await db.commit()
    await db.refresh(csid)

    return CsrResponse(csid_id=csid.id, csr_pem=csr_pem)


# ---------------------------------------------------------------------------
# 2. Compliance CSID
# ---------------------------------------------------------------------------


class ComplianceRequest(BaseModel):
    csid_id: UUID
    otp: str


class ComplianceResponse(BaseModel):
    csid_id: UUID
    request_id: str
    issued_at: datetime


@router.post("/compliance", response_model=ComplianceResponse)
async def issue_compliance_csid(
    req: ComplianceRequest, user: CurrentUserDep, db: DbSession
) -> ComplianceResponse:
    csid = await db.scalar(
        select(Csid).where(
            Csid.id == req.csid_id,
            Csid.tenant_id == user.tenant_id,
            Csid.kind == "compliance",
        )
    )
    if csid is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "csid_not_found")
    if csid.certificate_pem is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "ccsid_already_issued")

    env = ZatcaEnv(csid.env)
    client = ZatcaClient(env)
    resp = await client.request_compliance_csid(csid.csr_pem, req.otp)
    if resp.status_code >= 400:
        # ZATCA returns "Invalid-CSR" generically for many things — including
        # a wrong OTP — so we have to disambiguate by environment + payload.
        # The CSR has already been verified structurally (correct OIDs, EC
        # secp256k1, Microsoft template extension, etc.) when generated, so
        # OTP mismatch is the overwhelmingly common cause.
        raw = resp.raw_text[:400]
        hint = ""
        if "Missing-OTP" in raw:
            hint = " — the OTP field was empty when submitted."
        elif "Invalid-CSR" in raw or "Invalid Request" in raw or resp.status_code == 400:
            hint = (
                " — most commonly the OTP is wrong or expired (they're valid "
                "for ~1 hour). Generate a fresh OTP at "
                "https://fatoora.zatca.gov.sa for this org id and retry. "
                "Less commonly, the org_id isn't registered with ZATCA yet."
            )
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            f"zatca {resp.status_code}: {raw}{hint}",
        )

    body = resp.body
    token = body.get("binarySecurityToken")
    csid.binary_security_token = token
    csid.secret = body.get("secret")
    # ZATCA returns requestID as an integer (e.g. 1234567890123) but the
    # column is VARCHAR — coerce to str. None stays None.
    raw_req_id = body.get("requestID") or body.get("requestId")
    csid.request_id = str(raw_req_id) if raw_req_id is not None else None
    # The certificate IS the binarySecurityToken (base64-encoded). ZATCA does
    # not send a separate `certificate` field. Derive a PEM from the token.
    csid.certificate_pem = (
        body.get("certificate")
        or body.get("Certificate")
        or _binary_token_to_pem(token)
    )
    csid.disposition_message = body.get("dispositionMessage")
    csid.issued_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(csid)

    return ComplianceResponse(
        csid_id=csid.id,
        request_id=csid.request_id or "",
        issued_at=csid.issued_at,
    )


# ---------------------------------------------------------------------------
# 3. Compliance demo invoices (gate before PCSID)
# ---------------------------------------------------------------------------


class ComplianceCheckRequest(BaseModel):
    csid_id: UUID


class ComplianceCheckItem(BaseModel):
    scenario: str
    doc_type: str
    invoice_number: str
    http_status: int | None
    zatca_status: str | None
    passed: bool
    error: str | None


class CompliancePreviewItem(BaseModel):
    scenario: str
    doc_type: str
    description: str


class ComplianceCheckResponse(BaseModel):
    invoice_type: str
    total: int
    passed: int
    all_passed: bool
    items: list[ComplianceCheckItem]


_SCENARIO_DESCRIPTIONS = {
    "basic":             "Plain 100 SAR + 15% VAT — exercises the basic invoice + line VAT path.",
    "line_discount":     "Two lines, first has a 100 SAR price-level discount inside <cac:Price>.",
    "doc_discount":      "1000 SAR line + 100 SAR document-level discount under <cac:AllowanceCharge>.",
    "mixed_vat":         "Two lines under different tax categories (Standard 15% + Zero-rated 0%).",
    "multi_line_basket": "Three-item retail basket (coffee, headphones, notebook) under standard 15%.",
    "credit_note":       "Partial refund of 50 SAR referencing the basic invoice.",
    "debit_note":        "Additional 30 SAR fee referencing the basic invoice.",
}


@router.get("/compliance-check/preview", response_model=list[CompliancePreviewItem])
async def preview_compliance_check(
    csid_id: UUID, user: CurrentUserDep, db: DbSession
) -> list[CompliancePreviewItem]:
    """Tell the UI which scenarios will be sent, in order — purely informational."""
    csid = await db.scalar(
        select(Csid).where(
            Csid.id == csid_id,
            Csid.tenant_id == user.tenant_id,
            Csid.kind == "compliance",
        )
    )
    if csid is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "csid_not_found")
    cfg = await db.scalar(
        select(CsrConfig).where(
            CsrConfig.tenant_id == user.tenant_id,
            CsrConfig.env == csid.env,
        )
    )
    if cfg is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "csr_config_not_found")
    return [
        CompliancePreviewItem(
            scenario=scenario,
            doc_type=doc_type,
            description=_SCENARIO_DESCRIPTIONS.get(scenario, ""),
        )
        for scenario, doc_type in scenarios_for_invoice_type(cfg.invoice_type)
    ]


@router.post("/compliance-check", response_model=ComplianceCheckResponse)
async def run_compliance_check(
    req: ComplianceCheckRequest, user: CurrentUserDep, db: DbSession
) -> ComplianceCheckResponse:
    csid = await db.scalar(
        select(Csid).where(
            Csid.id == req.csid_id,
            Csid.tenant_id == user.tenant_id,
            Csid.kind == "compliance",
        )
    )
    if csid is None or not csid.certificate_pem:
        raise HTTPException(status.HTTP_412_PRECONDITION_FAILED, "ccsid_not_issued")
    if not csid.binary_security_token or not csid.secret:
        raise HTTPException(status.HTTP_412_PRECONDITION_FAILED, "ccsid_missing_credentials")

    cfg = await db.scalar(
        select(CsrConfig).where(
            CsrConfig.tenant_id == user.tenant_id,
            CsrConfig.env == csid.env,
        )
    )
    tenant = await db.scalar(select(Tenant).where(Tenant.id == user.tenant_id))
    if cfg is None or tenant is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "csr_or_tenant_missing")

    payloads = build_compliance_demo_set(cfg=cfg, tenant=tenant)
    scenarios = scenarios_for_invoice_type(cfg.invoice_type)
    # payloads is the same length and order as scenarios — zip them so each
    # result line carries its scenario name through to the UI.

    # Compliance checks have their own PIH chain — start from genesis and chain locally.
    GENESIS_PIH = "NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ=="
    prev_pih = GENESIS_PIH
    icv = 0

    client = ZatcaClient(ZatcaEnv(csid.env))
    items: list[ComplianceCheckItem] = []

    for (scenario_name, _doc_type), (kind, payload) in zip(scenarios, payloads, strict=True):
        icv += 1
        bound = payload.model_copy(update={"icv": icv, "pih_b64": prev_pih})
        processed = process_invoice(
            bound,
            private_key_pem=csid.private_key_pem,
            certificate_pem=csid.certificate_pem,
        )
        invoice_b64 = base64.b64encode(processed.signed_xml).decode()

        resp = await client.submit_compliance_invoice(
            binary_security_token=csid.binary_security_token,
            secret=csid.secret,
            invoice_b64=invoice_b64,
            invoice_hash=processed.invoice_hash_b64,
            uuid=str(bound.uuid),
        )

        zatca_status = str(
            resp.body.get("clearanceStatus")
            or resp.body.get("reportingStatus")
            or resp.body.get("status")
            or ""
        ).upper()
        passed = (
            200 <= resp.status_code < 300
            and zatca_status in {"CLEARED", "REPORTED"}
        )
        items.append(ComplianceCheckItem(
            scenario=scenario_name,
            doc_type=kind,
            invoice_number=bound.invoice_number,
            http_status=resp.status_code,
            zatca_status=zatca_status or None,
            passed=passed,
            error=None if passed else _extract_error_messages(resp),
        ))

        # Per spec, PIH advances regardless of acceptance — we sent it on the wire.
        prev_pih = processed.invoice_hash_b64

    all_passed = all(it.passed for it in items)
    if all_passed:
        csid.compliance_passed_at = datetime.now(timezone.utc)
        await db.commit()

    return ComplianceCheckResponse(
        invoice_type=cfg.invoice_type,
        total=len(items),
        passed=sum(1 for it in items if it.passed),
        all_passed=all_passed,
        items=items,
    )


# ---------------------------------------------------------------------------
# 4. Production CSID (gated on compliance pass)
# ---------------------------------------------------------------------------


class ProductionRequest(BaseModel):
    compliance_csid_id: UUID


class ProductionResponse(BaseModel):
    csid_id: UUID
    issued_at: datetime


@router.post("/production", response_model=ProductionResponse)
async def issue_production_csid(
    req: ProductionRequest, user: CurrentUserDep, db: DbSession
) -> ProductionResponse:
    parent = await db.scalar(
        select(Csid).where(
            Csid.id == req.compliance_csid_id,
            Csid.tenant_id == user.tenant_id,
            Csid.kind == "compliance",
        )
    )
    if parent is None or not parent.binary_security_token or not parent.secret:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "compliance_csid_not_ready")
    if not parent.request_id:
        raise HTTPException(status.HTTP_409_CONFLICT, "missing_compliance_request_id")
    if parent.compliance_passed_at is None:
        raise HTTPException(status.HTTP_412_PRECONDITION_FAILED, "compliance_checks_not_passed")

    env = ZatcaEnv(parent.env)
    client = ZatcaClient(env)
    resp = await client.request_production_csid(
        binary_security_token=parent.binary_security_token,
        secret=parent.secret,
        compliance_request_id=parent.request_id,
    )
    if resp.status_code >= 400:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"zatca_error:{resp.raw_text[:300]}")

    body = resp.body
    prod = Csid(
        tenant_id=user.tenant_id,
        env=parent.env,
        kind="production",
        private_key_pem=parent.private_key_pem,
        csr_pem=parent.csr_pem,
        certificate_pem=(
            body.get("certificate")
            or body.get("Certificate")
            or _binary_token_to_pem(body.get("binarySecurityToken"))
        ),
        binary_security_token=body.get("binarySecurityToken"),
        secret=body.get("secret"),
        request_id=(
            str(body.get("requestID") or body.get("requestId"))
            if (body.get("requestID") or body.get("requestId")) is not None
            else None
        ),
        disposition_message=body.get("dispositionMessage"),
        issued_at=datetime.now(timezone.utc),
    )
    db.add(prod)
    await db.commit()
    await db.refresh(prod)

    return ProductionResponse(csid_id=prod.id, issued_at=prod.issued_at or datetime.now(timezone.utc))
