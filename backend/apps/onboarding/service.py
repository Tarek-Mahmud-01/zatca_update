import base64
from datetime import timezone, datetime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from apps.zatca.keys import generate_private_key, serialize_private_key_pem
from apps.zatca.csr import CsrConfigInput, CsrTemplate, build_csr
from apps.zatca.client import ZatcaClient
from apps.onboarding.models import CsrConfig, Csid
from app.config import ZatcaEnv

class OnboardingService:
    def __init__(self, db: AsyncSession): self.db = db

    async def save_csr_config(self, tenant_id, data: dict) -> CsrConfig:
        # Delete any existing config for this tenant+env
        existing = await self.db.execute(
            select(CsrConfig).where(CsrConfig.tenant_id == tenant_id, CsrConfig.env == data["env"])
        )
        for row in existing.scalars():
            await self.db.delete(row)
        cfg = CsrConfig(tenant_id=tenant_id, **data)
        self.db.add(cfg)
        await self.db.commit()
        await self.db.refresh(cfg)
        return cfg

    async def request_compliance_csid(self, tenant_id, env: str, otp: str) -> dict:
        # Get CSR config for this tenant+env
        result = await self.db.execute(
            select(CsrConfig).where(CsrConfig.tenant_id == tenant_id, CsrConfig.env == env)
        )
        csr_cfg = result.scalar_one_or_none()
        if not csr_cfg:
            raise ValueError("CSR config not found for this env — call POST /onboarding/csr-config first")

        # Generate fresh key + CSR
        template = CsrTemplate.simulation if env == "simulation" else CsrTemplate.sandbox
        priv_key = generate_private_key()
        cfg_input = CsrConfigInput(
            common_name=csr_cfg.common_name,
            serial_number=csr_cfg.serial_number,
            organization_identifier=csr_cfg.organization_identifier,
            organization_unit_name=csr_cfg.organization_unit_name,
            organization_name=csr_cfg.organization_name,
            country_name=csr_cfg.country_name,
            invoice_type=csr_cfg.invoice_type,
            location_address=csr_cfg.location_address,
            industry_business_category=csr_cfg.industry_business_category,
        )
        csr_pem = build_csr(cfg_input, priv_key, template)
        priv_pem = serialize_private_key_pem(priv_key)

        # Call ZATCA
        client = ZatcaClient(env)
        resp = await client.request_compliance_csid(csr_pem, otp)
        if resp.status_code != 200:
            raise ValueError(f"ZATCA returned {resp.status_code}: {resp.raw_text[:300]}")

        body = resp.body
        token = body["binarySecurityToken"]
        # Derive PEM from double-base64 token
        inner = base64.b64decode(token.strip()).decode().strip()
        der = base64.b64decode(inner)
        b64 = base64.b64encode(der).decode()
        wrapped = "\n".join(b64[i:i+64] for i in range(0, len(b64), 64))
        cert_pem = f"-----BEGIN CERTIFICATE-----\n{wrapped}\n-----END CERTIFICATE-----\n"

        # Revoke old CCSID for this tenant+env
        old = await self.db.execute(
            select(Csid).where(Csid.tenant_id == tenant_id, Csid.env == env, Csid.kind == "ccsid")
        )
        for row in old.scalars():
            await self.db.delete(row)

        csid = Csid(
            tenant_id=tenant_id, env=env, kind="ccsid",
            private_key_pem=priv_pem, csr_pem=csr_pem,
            certificate_pem=cert_pem,
            binary_security_token=token,
            secret=body["secret"],
            request_id=str(body.get("requestID") or ""),
            issued_at=datetime.now(timezone.utc),
            is_dev=(env == "sandbox"),
        )
        self.db.add(csid)
        await self.db.commit()
        await self.db.refresh(csid)
        return {"ok": True, "env": env, "request_id": csid.request_id, "csid_id": str(csid.id)}

    async def request_production_csid(self, tenant_id, env: str) -> dict:
        # Get CCSID for this env
        result = await self.db.execute(
            select(Csid).where(Csid.tenant_id == tenant_id, Csid.env == env, Csid.kind == "ccsid")
        )
        ccsid = result.scalar_one_or_none()
        if not ccsid or not ccsid.binary_security_token:
            raise ValueError("No compliance CSID found — run compliance onboarding first")
        if not ccsid.request_id:
            raise ValueError("compliance_request_id missing — cannot request production CSID")

        client = ZatcaClient(env)
        resp = await client.request_production_csid(
            binary_security_token=ccsid.binary_security_token,
            secret=ccsid.secret,
            compliance_request_id=ccsid.request_id,
        )
        if resp.status_code not in (200, 202):
            raise ValueError(f"ZATCA returned {resp.status_code}: {resp.raw_text[:300]}")

        body = resp.body
        token = body["binarySecurityToken"]
        inner = base64.b64decode(token.strip()).decode().strip()
        der = base64.b64decode(inner)
        b64 = base64.b64encode(der).decode()
        wrapped = "\n".join(b64[i:i+64] for i in range(0, len(b64), 64))
        cert_pem = f"-----BEGIN CERTIFICATE-----\n{wrapped}\n-----END CERTIFICATE-----\n"

        # Revoke old PCSID
        old = await self.db.execute(
            select(Csid).where(Csid.tenant_id == tenant_id, Csid.env == env, Csid.kind == "pcsid")
        )
        for row in old.scalars():
            await self.db.delete(row)

        # Create PCSID using same private key+CSR as the CCSID
        pcsid = Csid(
            tenant_id=tenant_id, env=env, kind="pcsid",
            private_key_pem=ccsid.private_key_pem,
            csr_pem=ccsid.csr_pem,
            certificate_pem=cert_pem,
            binary_security_token=token,
            secret=body["secret"],
            request_id=str(body.get("requestID") or ""),
            issued_at=datetime.now(timezone.utc),
            is_dev=False,
        )
        self.db.add(pcsid)
        await self.db.commit()
        await self.db.refresh(pcsid)
        return {"ok": True, "env": env, "pcsid_id": str(pcsid.id)}

    async def get_status(self, tenant_id, env: str) -> dict:
        ccsid_r = await self.db.execute(
            select(Csid).where(Csid.tenant_id == tenant_id, Csid.env == env, Csid.kind == "ccsid")
        )
        pcsid_r = await self.db.execute(
            select(Csid).where(Csid.tenant_id == tenant_id, Csid.env == env, Csid.kind == "pcsid")
        )
        ccsid = ccsid_r.scalar_one_or_none()
        pcsid = pcsid_r.scalar_one_or_none()
        return {
            "env": env,
            "has_ccsid": ccsid is not None,
            "has_pcsid": pcsid is not None,
            "ccsid_request_id": ccsid.request_id if ccsid else None,
            "pcsid_issued_at": pcsid.issued_at.isoformat() if pcsid and pcsid.issued_at else None,
        }
