"""HTTPX client for ZATCA's REST endpoints.

Endpoints implemented (all under the env base URL):

  POST  /compliance                       — request CCSID (CSR + OTP)
  POST  /compliance/invoices              — submit compliance test invoice (CCSID auth)
  POST  /production/csids                 — promote CCSID → PCSID
  PATCH /production/csids                 — renew PCSID
  POST  /invoices/clearance/single        — standard invoice clearance
  POST  /invoices/reporting/single        — simplified invoice reporting

Auth is HTTP Basic with username/password derived from the relevant CSID:
  - For CCSID issuance:  user = OTP            , pass = ""
  - For compliance test: user = binarySecToken , pass = secret
  - For PCSID promotion: user = binarySecToken , pass = secret  (compliance CSID)
  - For prod submission: user = binarySecToken , pass = secret  (production CSID)
"""
from __future__ import annotations

import base64
from dataclasses import dataclass
from typing import Any

import httpx

from app.config import ZatcaEnv, get_settings


@dataclass(frozen=True, slots=True)
class ZatcaResponse:
    status_code: int
    body: dict[str, Any]
    raw_text: str


class ZatcaClient:
    def __init__(self, env: ZatcaEnv, timeout: float = 30.0) -> None:
        self._base_url = get_settings().zatca_base_url(env).rstrip("/")
        self._timeout = timeout

    @staticmethod
    def _basic_auth(user: str, password: str = "") -> str:
        token = base64.b64encode(f"{user}:{password}".encode()).decode()
        return f"Basic {token}"

    def _headers(self, auth: str | None) -> dict[str, str]:
        h = {
            "Accept": "application/json",
            "Accept-Version": "V2",
            "Accept-Language": "en",
            "Content-Type": "application/json",
        }
        if auth:
            h["Authorization"] = auth
        return h

    async def _post(
        self, path: str, *, json: dict, auth: str | None, extra_headers: dict[str, str] | None = None
    ) -> ZatcaResponse:
        url = f"{self._base_url}{path}"
        headers = self._headers(auth)
        if extra_headers:
            headers.update(extra_headers)
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.post(url, json=json, headers=headers)
        try:
            body = resp.json() if resp.content else {}
        except ValueError:
            body = {}
        return ZatcaResponse(status_code=resp.status_code, body=body, raw_text=resp.text)

    async def _patch(
        self, path: str, *, json: dict, auth: str, extra_headers: dict[str, str] | None = None
    ) -> ZatcaResponse:
        url = f"{self._base_url}{path}"
        headers = self._headers(auth)
        if extra_headers:
            headers.update(extra_headers)
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.patch(url, json=json, headers=headers)
        try:
            body = resp.json() if resp.content else {}
        except ValueError:
            body = {}
        return ZatcaResponse(status_code=resp.status_code, body=body, raw_text=resp.text)

    # ---- onboarding -----------------------------------------------------

    async def request_compliance_csid(self, csr_pem: str, otp: str) -> ZatcaResponse:
        # ZATCA's /compliance accepts ONLY the OTP header — no Basic auth.
        # Authorization is established for subsequent calls via the CCSID it returns.
        return await self._post(
            "/compliance",
            json={"csr": base64.b64encode(csr_pem.encode()).decode()},
            auth=None,
            extra_headers={"OTP": otp},
        )

    async def submit_compliance_invoice(
        self,
        *,
        binary_security_token: str,
        secret: str,
        invoice_b64: str,
        invoice_hash: str,
        uuid: str,
    ) -> ZatcaResponse:
        return await self._post(
            "/compliance/invoices",
            json={"invoiceHash": invoice_hash, "uuid": uuid, "invoice": invoice_b64},
            auth=self._basic_auth(binary_security_token, secret),
        )

    async def request_production_csid(
        self, *, binary_security_token: str, secret: str, compliance_request_id: str
    ) -> ZatcaResponse:
        return await self._post(
            "/production/csids",
            json={"compliance_request_id": compliance_request_id},
            auth=self._basic_auth(binary_security_token, secret),
        )

    async def renew_production_csid(
        self, *, binary_security_token: str, secret: str, otp: str, csr_pem: str
    ) -> ZatcaResponse:
        # Renewal: authenticate with the EXISTING production CSID's
        # token+secret, supply a fresh OTP header and a NEW CSR. ZATCA returns
        # a new production binarySecurityToken + secret.
        return await self._patch(
            "/production/csids",
            json={"csr": base64.b64encode(csr_pem.encode()).decode()},
            auth=self._basic_auth(binary_security_token, secret),
            extra_headers={"OTP": otp},
        )

    # ---- live submission ------------------------------------------------

    async def submit_clearance(
        self,
        *,
        binary_security_token: str,
        secret: str,
        invoice_b64: str,
        invoice_hash: str,
        uuid: str,
    ) -> ZatcaResponse:
        return await self._post(
            "/invoices/clearance/single",
            json={"invoiceHash": invoice_hash, "uuid": uuid, "invoice": invoice_b64},
            auth=self._basic_auth(binary_security_token, secret),
            extra_headers={"Clearance-Status": "1"},
        )

    async def submit_reporting(
        self,
        *,
        binary_security_token: str,
        secret: str,
        invoice_b64: str,
        invoice_hash: str,
        uuid: str,
    ) -> ZatcaResponse:
        return await self._post(
            "/invoices/reporting/single",
            json={"invoiceHash": invoice_hash, "uuid": uuid, "invoice": invoice_b64},
            auth=self._basic_auth(binary_security_token, secret),
            extra_headers={"Clearance-Status": "0"},
        )
