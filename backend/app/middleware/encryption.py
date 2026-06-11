"""ASGI middleware: decrypt request bodies / encrypt response bodies.

A request is treated as encrypted when it carries:
  X-Encrypted: 1
  X-Client-Pubkey: <base64-SPKI-DER of client's ephemeral EC P-256 public key>

The middleware derives the shared AES-256-GCM key via ECDH + HKDF using the
server's private key (generated in app.crypto) and the client's public key.
It then:
  - Replaces the raw request body with the AES-GCM decrypted plaintext.
  - Buffers the full response, encrypts it with the same key, and re-wraps it
    in an {iv, data} JSON envelope with X-Encrypted: 1 set on the response.

OPTIONS (CORS preflight) and the /crypto/* endpoints are always passed through.
"""
from __future__ import annotations

import base64
import json
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from starlette.types import ASGIApp, Receive, Scope, Send


class PayloadEncryptionMiddleware:
    def __init__(self, app: "ASGIApp") -> None:
        self.app = app

    async def __call__(self, scope: "Scope", receive: "Receive", send: "Send") -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        # Build a quick header lookup
        raw_headers: list[tuple[bytes, bytes]] = scope.get("headers", [])
        hmap = {k.lower(): v for k, v in raw_headers}

        method = scope.get("method", b"").upper()
        path = scope.get("path", "")

        # Always pass through CORS preflight and the public-key bootstrap endpoint
        if method == b"OPTIONS" or path.startswith("/api/v1/crypto/"):
            await self.app(scope, receive, send)
            return

        if hmap.get(b"x-encrypted") != b"1":
            await self.app(scope, receive, send)
            return

        # ---------- obtain shared key ----------
        client_pubkey_b64 = hmap.get(b"x-client-pubkey", b"").decode()
        if not client_pubkey_b64:
            await _send_error(send, 400, "X-Client-Pubkey header required")
            return

        try:
            from app.crypto import derive_shared_key
            aes_key = derive_shared_key(base64.b64decode(client_pubkey_b64))
        except Exception as exc:
            await _send_error(send, 400, f"Key derivation failed: {exc}")
            return

        # ---------- decrypt request body ----------
        body_chunks: list[bytes] = []
        more = True
        while more:
            msg = await receive()
            body_chunks.append(msg.get("body", b""))
            more = msg.get("more_body", False)

        raw_body = b"".join(body_chunks)

        if raw_body:
            try:
                envelope = json.loads(raw_body)
                iv = base64.b64decode(envelope["iv"])
                ct = base64.b64decode(envelope["data"])
                from app.crypto import aes_decrypt
                raw_body = aes_decrypt(aes_key, iv, ct)
            except Exception as exc:
                await _send_error(send, 400, f"Decryption failed: {exc}")
                return

        # Update scope headers: set content-type + content-length for the decrypted body
        new_headers = [
            (k, v) for k, v in raw_headers
            if k.lower() not in (b"content-type", b"content-length", b"transfer-encoding")
        ]
        new_headers.append((b"content-type", b"application/json"))
        new_headers.append((b"content-length", str(len(raw_body)).encode()))
        scope = dict(scope)
        scope["headers"] = new_headers

        async def patched_receive() -> dict:
            return {"type": "http.request", "body": raw_body, "more_body": False}

        # ---------- intercept response + encrypt ----------
        resp_status = 200
        resp_headers: list[tuple[bytes, bytes]] = []
        resp_chunks: list[bytes] = []
        started = False

        async def patched_send(message: dict) -> None:
            nonlocal resp_status, resp_headers, started
            if message["type"] == "http.response.start":
                resp_status = message["status"]
                resp_headers = list(message.get("headers", []))
                started = True
            elif message["type"] == "http.response.body":
                resp_chunks.append(message.get("body", b""))
                if not message.get("more_body", False):
                    full = b"".join(resp_chunks)
                    try:
                        from app.crypto import aes_encrypt
                        iv, ct = aes_encrypt(aes_key, full)
                        encrypted = json.dumps({
                            "iv": base64.b64encode(iv).decode(),
                            "data": base64.b64encode(ct).decode(),
                        }).encode()
                    except Exception as exc:
                        await _send_error(send, 500, f"Response encryption failed: {exc}")
                        return

                    out_headers = [
                        (k, v) for k, v in resp_headers
                        if k.lower() not in (b"content-length", b"content-type", b"transfer-encoding")
                    ]
                    out_headers.append((b"content-type", b"application/json"))
                    out_headers.append((b"x-encrypted", b"1"))
                    out_headers.append((b"content-length", str(len(encrypted)).encode()))

                    await send({
                        "type": "http.response.start",
                        "status": resp_status,
                        "headers": out_headers,
                    })
                    await send({
                        "type": "http.response.body",
                        "body": encrypted,
                        "more_body": False,
                    })

        await self.app(scope, patched_receive, patched_send)


async def _send_error(send: "Send", status: int, message: str) -> None:
    body = json.dumps({"error": message}).encode()
    await send({
        "type": "http.response.start",
        "status": status,
        "headers": [
            (b"content-type", b"application/json"),
            (b"content-length", str(len(body)).encode()),
        ],
    })
    await send({"type": "http.response.body", "body": body, "more_body": False})
