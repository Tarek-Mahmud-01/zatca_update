"""Tenant-scoped event bus.

Producers (HTTP routes, arq worker, submitter) publish JSON events on
``tenant:{tenant_id}:events``. Consumers (the SSE endpoint) subscribe to that
channel and stream events to every connected user of the tenant.

Delivery is dual-channel — events fan out via BOTH:

  1. **Redis pub/sub** — works across uvicorn workers and arq processes.
     Best-effort; a circuit breaker skips Redis for 30s after a failure so
     bulk operations don't get charged the connect-fail latency.
  2. **In-process asyncio queues** — works WITHOUT Redis when publisher and
     subscriber live in the same process (the common dev setup). Guarantees
     the frontend SEE the event even with Redis down.

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
"""
from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from redis.exceptions import RedisError

from app.redis_client import get_redis, is_breaker_open, trip_breaker

_REDIS_OFFLINE = (RedisError, OSError, ConnectionError, TimeoutError)

# Per-channel in-process subscriber queues. Each SSE connection gets its own
# queue so a slow client can't block others. When Redis is down this is the
# only delivery channel; when Redis is up it adds same-process delivery on
# top so the publisher doesn't depend on round-tripping through Redis.
_local_queues: dict[str, set[asyncio.Queue[str]]] = {}


def _channel(tenant_id: UUID | str) -> str:
    return f"tenant:{tenant_id}:events"


def _local_publish(ch: str, message: str) -> None:
    """Fan a serialised event out to every in-process subscriber on ``ch``.

    Non-blocking: drops on full queue rather than waiting on slow consumers.
    """
    subs = _local_queues.get(ch)
    if not subs:
        return
    for q in subs:
        try:
            q.put_nowait(message)
        except asyncio.QueueFull:
            pass


async def publish(tenant_id: UUID | str, event_type: str, **payload: Any) -> None:
    """Fire-and-forget publish to the tenant's channel.

    Delivers in-process first (always works, same uvicorn process), then
    tries Redis (cross-process). Redis being down is a degradation — SSE
    clients in OTHER processes won't see the event, but local ones still
    will.
    """
    body = {
        "type": event_type,
        "ts": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        **payload,
    }
    message = json.dumps(body, default=str)
    ch = _channel(tenant_id)
    _local_publish(ch, message)
    if is_breaker_open():
        return
    try:
        await get_redis().publish(ch, message)
    except _REDIS_OFFLINE:
        trip_breaker()


async def subscribe(tenant_id: UUID | str) -> AsyncIterator[str]:
    """Async generator yielding raw JSON event strings for SSE relay.

    Registers an in-process queue AND attempts to subscribe via Redis. The
    in-process queue guarantees same-process delivery; Redis adds cross-
    process delivery when reachable. Both paths feed the same yielded
    stream — the SSE endpoint sees one event per publish().
    """
    ch = _channel(tenant_id)
    queue: asyncio.Queue[str] = asyncio.Queue(maxsize=256)
    _local_queues.setdefault(ch, set()).add(queue)

    redis_pubsub = None
    redis_task: asyncio.Task | None = None
    if not is_breaker_open():
        try:
            redis_pubsub = get_redis().pubsub()
            await redis_pubsub.subscribe(ch)

            async def _pump_redis() -> None:
                try:
                    async for msg in redis_pubsub.listen():
                        if not msg or msg.get("type") != "message":
                            continue
                        data = msg.get("data")
                        if isinstance(data, bytes):
                            data = data.decode()
                        try:
                            queue.put_nowait(str(data))
                        except asyncio.QueueFull:
                            pass
                except _REDIS_OFFLINE:
                    trip_breaker()

            redis_task = asyncio.create_task(_pump_redis())
        except _REDIS_OFFLINE:
            trip_breaker()
            redis_pubsub = None

    try:
        while True:
            yield await queue.get()
    finally:
        _local_queues.get(ch, set()).discard(queue)
        if not _local_queues.get(ch):
            _local_queues.pop(ch, None)
        if redis_task is not None:
            redis_task.cancel()
        if redis_pubsub is not None:
            try:
                await redis_pubsub.unsubscribe(ch)
                await redis_pubsub.aclose()
            except _REDIS_OFFLINE:
                pass
