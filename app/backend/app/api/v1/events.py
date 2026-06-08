"""Server-Sent Events stream — pushes invoice lifecycle events to the browser.

Browsers can't add Authorization headers to ``EventSource``, so the stream is
authenticated with a short-lived, single-purpose *ticket* instead of the
long-lived API token (which would otherwise leak into the URL, access logs,
browser history and ``Referer`` headers).

Flow:

    1. POST /api/v1/events/ticket   (Authorization: Bearer <token>)  → { ticket }
    2. new EventSource(`/api/v1/events?ticket=<ticket>`)

The ticket carries ``typ="sse"``, expires within seconds (see
``sse_ticket_ttl_seconds``) and is rejected by the regular API, so even if it
lands in a log it grants nothing useful. The full API token never appears in a
URL. Auth is validated once at connect; every event yielded after that is
scoped to the ticket's tenant_id.
"""
from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator

from fastapi import APIRouter, HTTPException, Query, status
from sse_starlette.sse import EventSourceResponse

from app.config import get_settings
from app.deps import CurrentUserDep
from app.events import subscribe
from app.security import create_sse_ticket, decode_sse_ticket

router = APIRouter(prefix="/events", tags=["events"])

KEEPALIVE_SECONDS = 25


@router.post("/ticket")
async def mint_ticket(user: CurrentUserDep) -> dict:
    """Issue a short-lived ticket for opening the SSE stream.

    Authenticated via the normal ``Authorization: Bearer`` header, so the API
    token stays out of the stream URL. Returns the ticket plus its lifetime so
    the client knows how long it has to connect.
    """
    ticket = create_sse_ticket(user.user_id, user.tenant_id, user.role)
    return {
        "ticket": ticket,
        "expires_in": get_settings().sse_ticket_ttl_seconds,
    }


@router.get("")
async def stream_events(ticket: str = Query(..., description="Short-lived SSE ticket")) -> EventSourceResponse:
    try:
        payload = decode_sse_ticket(ticket)
    except ValueError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid_ticket")

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
