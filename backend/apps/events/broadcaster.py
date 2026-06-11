"""In-process asyncio pub/sub for real-time invoice events.

Each connected WebSocket client registers a Queue.  When an invoice
status changes, publish() drops the event into every queue that belongs
to the same tenant.  No Redis required — works out of the box; if you
later need multi-process delivery, swap publish() for a Redis Streams
fanout and keep the rest unchanged.
"""
from __future__ import annotations

import asyncio
from typing import Any

# tenant_id (str) → list of queues belonging to connected WS clients
_subs: dict[str, list[asyncio.Queue[dict[str, Any]]]] = {}


async def subscribe(tenant_id: str) -> asyncio.Queue[dict[str, Any]]:
    q: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
    _subs.setdefault(str(tenant_id), []).append(q)
    return q


def unsubscribe(tenant_id: str, q: asyncio.Queue[dict[str, Any]]) -> None:
    bucket = _subs.get(str(tenant_id))
    if bucket and q in bucket:
        bucket.remove(q)
    if bucket is not None and not bucket:
        _subs.pop(str(tenant_id), None)


async def publish(tenant_id: str, event: dict[str, Any]) -> None:
    for q in list(_subs.get(str(tenant_id), [])):
        await q.put(event)
