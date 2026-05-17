"""Verify that ZatcaClient hits the right endpoint for each operation,
with the right method, headers, and body shape. ZATCA is mocked with respx.

This is the test that locks down "simplified -> /reporting/single" and
"standard -> /clearance/single", plus the compliance flow.
"""
import base64

import httpx
import pytest
import respx

from app.config import ZatcaEnv, get_settings
from app.zatca.client import ZatcaClient


SETTINGS = get_settings()
SANDBOX = SETTINGS.zatca_base_url(ZatcaEnv.sandbox).rstrip("/")
SIMULATION = SETTINGS.zatca_base_url(ZatcaEnv.simulation).rstrip("/")


@pytest.fixture
def client() -> ZatcaClient:
    return ZatcaClient(ZatcaEnv.sandbox)


# ---------------------------------------------------------------------------
# compliance flow
# ---------------------------------------------------------------------------


async def test_compliance_csid_sends_otp_header_only(client: ZatcaClient) -> None:
    """ZATCA /compliance must receive the OTP header and NO Authorization."""
    with respx.mock(base_url=SANDBOX) as mock:
        route = mock.post("/compliance").mock(
            return_value=httpx.Response(
                200, json={"binarySecurityToken": "bst", "secret": "sec", "requestID": "r1"}
            )
        )
        await client.request_compliance_csid("-----CSR-----\nABC\n-----END-----\n", "555111")

        assert route.called
        req = route.calls[0].request
        assert req.headers.get("OTP") == "555111"
        assert "Authorization" not in req.headers, (
            "Authorization header must not be sent to /compliance (verified empirically)"
        )
        assert req.headers["Accept-Version"] == "V2"
        body = req.read()
        assert b'"csr":' in body
        # CSR must be base64-encoded
        import json
        payload = json.loads(body)
        decoded = base64.b64decode(payload["csr"]).decode()
        assert "-----CSR-----" in decoded


async def test_compliance_invoice_uses_basic_auth_from_ccsid(client: ZatcaClient) -> None:
    """/compliance/invoices is authenticated with Basic(bst:secret)."""
    with respx.mock(base_url=SANDBOX) as mock:
        route = mock.post("/compliance/invoices").mock(
            return_value=httpx.Response(200, json={"clearanceStatus": "CLEARED"})
        )
        await client.submit_compliance_invoice(
            binary_security_token="my-bst",
            secret="my-sec",
            invoice_b64="aW52b2ljZQ==",
            invoice_hash="ZGVhZGJlZWY=",
            uuid="00000000-0000-0000-0000-000000000001",
        )
        req = route.calls[0].request
        expected = "Basic " + base64.b64encode(b"my-bst:my-sec").decode()
        assert req.headers["Authorization"] == expected


# ---------------------------------------------------------------------------
# routing: reporting (B2C/simplified) vs clearance (B2B/standard)
# ---------------------------------------------------------------------------


async def test_reporting_route_for_simplified(client: ZatcaClient) -> None:
    """Simplified invoices go to /invoices/reporting/single with Clearance-Status: 0."""
    with respx.mock(base_url=SANDBOX, assert_all_called=False) as mock:
        report = mock.post("/invoices/reporting/single").mock(
            return_value=httpx.Response(200, json={"reportingStatus": "REPORTED"})
        )
        # Make sure we DON'T hit clearance by accident
        clearance = mock.post("/invoices/clearance/single").mock(
            return_value=httpx.Response(500, json={"error": "must not be called"})
        )
        await client.submit_reporting(
            binary_security_token="bst", secret="sec",
            invoice_b64="eA==", invoice_hash="aGFzaA==", uuid="u",
        )
        assert report.called
        assert not clearance.called
        req = report.calls[0].request
        assert req.headers["Clearance-Status"] == "0"


async def test_clearance_route_for_standard(client: ZatcaClient) -> None:
    """Standard invoices go to /invoices/clearance/single with Clearance-Status: 1."""
    with respx.mock(base_url=SANDBOX, assert_all_called=False) as mock:
        clearance = mock.post("/invoices/clearance/single").mock(
            return_value=httpx.Response(200, json={"clearanceStatus": "CLEARED", "clearedInvoice": "Y2xlYXJlZA=="})
        )
        report = mock.post("/invoices/reporting/single").mock(
            return_value=httpx.Response(500, json={"error": "must not be called"})
        )
        resp = await client.submit_clearance(
            binary_security_token="bst", secret="sec",
            invoice_b64="eA==", invoice_hash="aGFzaA==", uuid="u",
        )
        assert clearance.called
        assert not report.called
        req = clearance.calls[0].request
        assert req.headers["Clearance-Status"] == "1"
        assert resp.body["clearedInvoice"] == "Y2xlYXJlZA=="


async def test_request_body_shape_for_both_routes(client: ZatcaClient) -> None:
    """Both submission routes send {invoiceHash, uuid, invoice} JSON body."""
    import json
    with respx.mock(base_url=SANDBOX, assert_all_called=False) as mock:
        mock.post("/invoices/reporting/single").mock(return_value=httpx.Response(200, json={}))
        mock.post("/invoices/clearance/single").mock(return_value=httpx.Response(200, json={}))

        for fn in (client.submit_reporting, client.submit_clearance):
            for r in mock.routes:
                r.reset()
            await fn(
                binary_security_token="bst", secret="sec",
                invoice_b64="eA==", invoice_hash="aGFzaA==",
                uuid="00000000-0000-0000-0000-000000000123",
            )
            req = next(call.request for r in mock.routes for call in r.calls)
            body = json.loads(req.read())
            assert set(body.keys()) == {"invoiceHash", "uuid", "invoice"}
            assert body["invoiceHash"] == "aGFzaA=="
            assert body["uuid"] == "00000000-0000-0000-0000-000000000123"


# ---------------------------------------------------------------------------
# CCSID -> PCSID promotion
# ---------------------------------------------------------------------------


async def test_production_csid_uses_compliance_request_id_and_basic_auth(
    client: ZatcaClient,
) -> None:
    import json
    with respx.mock(base_url=SANDBOX) as mock:
        route = mock.post("/production/csids").mock(
            return_value=httpx.Response(200, json={"binarySecurityToken": "PROD", "secret": "PSEC"})
        )
        await client.request_production_csid(
            binary_security_token="bst", secret="sec", compliance_request_id="REQ-42",
        )
        req = route.calls[0].request
        assert req.headers["Authorization"] == "Basic " + base64.b64encode(b"bst:sec").decode()
        body = json.loads(req.read())
        assert body == {"compliance_request_id": "REQ-42"}


# ---------------------------------------------------------------------------
# error pass-through
# ---------------------------------------------------------------------------


async def test_4xx_response_is_surfaced_verbatim(client: ZatcaClient) -> None:
    """4xx from ZATCA should not raise — the route returns ZatcaResponse so the
    caller can decide whether to map to HTTP 502 or a friendlier message."""
    with respx.mock(base_url=SANDBOX) as mock:
        mock.post("/compliance").mock(return_value=httpx.Response(
            400, text='{"errorCode":"400","errorCategory":"Invalid-CSR","errorMessage":"..."}',
        ))
        resp = await client.request_compliance_csid("csr", "111111")
        assert resp.status_code == 400
        assert "Invalid-CSR" in resp.raw_text


async def test_5xx_response_does_not_raise(client: ZatcaClient) -> None:
    with respx.mock(base_url=SANDBOX) as mock:
        mock.post("/invoices/reporting/single").mock(return_value=httpx.Response(503, text="upstream"))
        resp = await client.submit_reporting(
            binary_security_token="bst", secret="sec",
            invoice_b64="eA==", invoice_hash="aGFzaA==", uuid="u",
        )
        assert resp.status_code == 503
