"""WebSocket events endpoint.

Clients connect with:
    ws://<host>/api/v1/events/ws?token=<JWT>

The JWT is validated on connect.  After that the server pushes invoice
events as JSON frames whenever the invoice pipeline changes status.
A keepalive {"type":"ping"} frame is sent every 25 s so idle connections
survive NAT/proxy timeouts.  The connection is closed with code 4401 when
the JWT expires or a new login displaces this session.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from app.security import decode_access_token
from apps.events.broadcaster import publish, subscribe, unsubscribe

router = APIRouter(prefix="/events", tags=["events"])

PING_INTERVAL = 25.0  # seconds between keepalive pings


@router.websocket("/ws")
async def events_ws(
    websocket: WebSocket,
    token: str = Query(..., description="Bearer JWT"),
) -> None:
    # Authenticate before accepting — close with 4401 on bad token.
    try:
        payload = decode_access_token(token)
        tenant_id: str = payload["tid"]
        user_id: str = payload["sub"]
        exp: float = float(payload.get("exp", 0))
    except Exception:
        await websocket.close(code=4401)
        return

    await websocket.accept()
    q = await subscribe(tenant_id)
    try:
        while True:
            now = datetime.now(timezone.utc).timestamp()
            if now >= exp:
                await websocket.send_json({"type": "session_expired"})
                await websocket.close(code=4401)
                return

            # Wait no longer than the time remaining on the token or the ping
            # interval, whichever is sooner — so the expiry close is precise.
            time_left = exp - now
            timeout = min(PING_INTERVAL, time_left)

            try:
                event = await asyncio.wait_for(q.get(), timeout=timeout)
                # Single-session enforcement: a new login displaced this session.
                if event.get("type") == "force_logout" and event.get("user_id") == user_id:
                    await websocket.send_json({"type": "force_logout"})
                    await websocket.close(code=4401)
                    return
                await websocket.send_json(event)
            except asyncio.TimeoutError:
                # Re-check expiry before sending ping (token may have just expired).
                if datetime.now(timezone.utc).timestamp() >= exp:
                    # Send the message first — browsers sometimes remap custom
                    # close codes to 1006, so the message is the reliable signal.
                    await websocket.send_json({"type": "session_expired"})
                    await websocket.close(code=4401)
                    return
                await websocket.send_json({"type": "ping"})
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        unsubscribe(tenant_id, q)
