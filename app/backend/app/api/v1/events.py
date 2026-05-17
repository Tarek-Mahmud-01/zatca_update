"""Server-Sent Events stream — pushes invoice lifecycle events to the browser.

Browsers can't add Authorization headers to ``EventSource``, so this route
accepts the JWT as a ``?token=...`` query parameter. Auth is validated once at
connect; every event yielded after that is scoped to the JWT's tenant_id.

Frontend usage:

    const es = new EventSource(`${BACKEND}/api/v1/events?token=${token}`);
    es.addEventListener("invoice.cleared", (e) => { ... });
"""
from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator

from fastapi import APIRouter, HTTPException, Query, status
from sse_starlette.sse import EventSourceResponse

from app.events import subscribe
from app.security import decode_access_token

router = APIRouter(prefix="/events", tags=["events"])

KEEPALIVE_SECONDS = 25


@router.get("")
async def stream_events(token: str = Query(..., description="JWT access token")) -> EventSourceResponse:
    try:
        payload = decode_access_token(token)
    except ValueError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid_token")

    tenant_id = payload["tid"]

    async def event_generator() -> AsyncIterator[dict]:
        # Initial hello so the client knows the stream is live
        yield {"event": "ready", "data": json.dumps({"tenant_id": tenant_id})}

        queue: asyncio.Queue[str] = asyncio.Queue(maxsize=1000)

        async def pump() -> None:
            async for raw in subscribe(tenant_id):
                try:
                    queue.put_nowait(raw)
                except asyncio.QueueFull:
                    pass

        pump_task = asyncio.create_task(pump())
        try:
            while True:
                try:
                    raw = await asyncio.wait_for(queue.get(), timeout=KEEPALIVE_SECONDS)
                except asyncio.TimeoutError:
                    yield {"event": "ping", "data": ""}
                    continue
                try:
                    body = json.loads(raw)
                except ValueError:
                    continue
                yield {
                    "event": body.get("type", "message"),
                    "data": raw,
                }
        finally:
            pump_task.cancel()

    return EventSourceResponse(event_generator())
