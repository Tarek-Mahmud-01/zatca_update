"""WebSocket events endpoint.

Clients connect with:
    ws://<host>/api/v1/events/ws?token=<JWT>

The JWT is validated on connect.  After that the server pushes invoice
events as JSON frames whenever the invoice pipeline changes status.
A keepalive {"type":"ping"} frame is sent every 25 s so idle connections
survive NAT/proxy timeouts.
"""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from app.security import decode_access_token
from apps.events.broadcaster import publish, subscribe, unsubscribe

router = APIRouter(prefix="/events", tags=["events"])


@router.websocket("/ws")
async def events_ws(
    websocket: WebSocket,
    token: str = Query(..., description="Bearer JWT"),
) -> None:
    # Authenticate before accepting — close with 4401 on bad token.
    try:
        payload = decode_access_token(token)
        tenant_id: str = payload["tid"]
    except Exception:
        await websocket.close(code=4401)
        return

    await websocket.accept()
    q = await subscribe(tenant_id)
    try:
        while True:
            try:
                event = await asyncio.wait_for(q.get(), timeout=25.0)
                await websocket.send_json(event)
            except asyncio.TimeoutError:
                await websocket.send_json({"type": "ping"})
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        unsubscribe(tenant_id, q)
