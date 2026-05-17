"""Tenant-scoped event bus over Redis pub/sub.

Producers (HTTP routes, arq worker) publish JSON events on
``tenant:{tenant_id}:events``. Consumers (the SSE endpoint) subscribe to that
channel and stream events to every connected user of the tenant.

Events have a stable, small shape:

    {
      "type": "invoice.queued" | "invoice.signed" | "invoice.cleared"
            | "invoice.reported" | "invoice.rejected" | "invoice.failed",
      "ts": "2026-05-16T10:00:00Z",
      "invoice_id": "<uuid>",
      "icv": 42,
      "doc_type": "simplified_invoice",
      "status": "cleared",
      "error": "..."   # optional
    }

Circuit breaker: when Redis is unreachable, subsequent publishes within the
breaker window are no-ops — without this, bulk operations (12-invoice seed)
were taking ~50s because each publish() tried to reconnect and slow-failed.
"""
from __future__ import annotations

import json
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from redis.exceptions import RedisError

from app.redis_client import get_redis, is_breaker_open, trip_breaker

_REDIS_OFFLINE = (RedisError, OSError, ConnectionError, TimeoutError)


def _channel(tenant_id: UUID | str) -> str:
    return f"tenant:{tenant_id}:events"


async def publish(tenant_id: UUID | str, event_type: str, **payload: Any) -> None:
    """Fire-and-forget publish to the tenant's channel.

    Redis being down is a degradation, not a fatal error — SSE clients just
    won't see live updates. We swallow the connection error so the caller's
    write path doesn't 500. A circuit breaker skips Redis entirely for 30s
    after a failure so bulk callers (12-invoice seed, batch upload) aren't
    each charged the connect-fail latency.
    """
    if is_breaker_open():
        return
    body = {
        "type": event_type,
        "ts": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        **payload,
    }
    try:
        await get_redis().publish(_channel(tenant_id), json.dumps(body, default=str))
    except _REDIS_OFFLINE:
        trip_breaker()


async def subscribe(tenant_id: UUID | str) -> AsyncIterator[str]:
    """Async generator yielding raw JSON event strings for SSE relay.

    The pubsub object is closed when the generator is GC'd / the request ends.
    """
    pubsub = get_redis().pubsub()
    await pubsub.subscribe(_channel(tenant_id))
    try:
        async for msg in pubsub.listen():
            if msg is None:
                continue
            if msg.get("type") != "message":
                continue
            data = msg.get("data")
            if isinstance(data, bytes):
                data = data.decode()
            yield str(data)
    finally:
        await pubsub.unsubscribe(_channel(tenant_id))
        await pubsub.aclose()
