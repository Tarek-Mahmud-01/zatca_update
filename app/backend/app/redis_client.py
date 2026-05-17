"""Shared Redis client + idempotency + per-tenant rate-limit helpers.

Every helper here treats Redis being unreachable as a *degradation*, not a fatal
error — the write path should still work without Redis. Rate-limiting fails open
(everything allowed), idempotency falls back to "no cached result", the JSON
cache simply misses. That makes single-host dev (where Redis often isn't running)
painless, and keeps production resilient if Redis hiccups for a few seconds.
"""
from __future__ import annotations

import json
import time
from functools import lru_cache
from typing import Any

import redis.asyncio as redis
from redis.exceptions import RedisError

from app.config import get_settings


@lru_cache(maxsize=1)
def get_redis() -> redis.Redis:
    return redis.from_url(
        get_settings().redis_url,
        decode_responses=True,
        socket_connect_timeout=0.5,
        socket_timeout=1.0,
    )


# Anything we'd treat as "Redis offline" — connect refused, timeout, generic
# RedisError, or the underlying OSError thrown by asyncio.open_connection.
_REDIS_OFFLINE = (RedisError, OSError, ConnectionError, TimeoutError)

_BREAKER_OPEN_UNTIL: float = 0.0
_BREAKER_COOLDOWN_SECONDS: float = 30.0


def is_breaker_open() -> bool:
    return time.monotonic() < _BREAKER_OPEN_UNTIL


def trip_breaker() -> None:
    global _BREAKER_OPEN_UNTIL
    _BREAKER_OPEN_UNTIL = time.monotonic() + _BREAKER_COOLDOWN_SECONDS


# ---------------------------------------------------------------------------
# Idempotency: clients send Idempotency-Key on POST /invoices.
# We store (tenant_id, key) -> invoice_id for 24h.
# ---------------------------------------------------------------------------


async def get_idempotent(tenant_id: str, key: str) -> str | None:
    if is_breaker_open():
        return None
    try:
        return await get_redis().get(f"idem:{tenant_id}:{key}")
    except _REDIS_OFFLINE:
        trip_breaker()
        return None


async def set_idempotent(tenant_id: str, key: str, invoice_id: str, ttl_seconds: int = 86400) -> None:
    if is_breaker_open():
        return
    try:
        await get_redis().set(f"idem:{tenant_id}:{key}", invoice_id, ex=ttl_seconds)
    except _REDIS_OFFLINE:
        trip_breaker()


# ---------------------------------------------------------------------------
# Token bucket rate limit (per tenant). Fails OPEN when Redis is down.
# ---------------------------------------------------------------------------


_TOKEN_BUCKET_LUA = """
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

local data = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(data[1])
local ts = tonumber(data[2])
if tokens == nil then
    tokens = capacity
    ts = now
end
local elapsed = math.max(0, now - ts)
tokens = math.min(capacity, tokens + elapsed * refill)
local allowed = 0
if tokens >= 1 then
    tokens = tokens - 1
    allowed = 1
end
redis.call('HMSET', key, 'tokens', tokens, 'ts', now)
redis.call('EXPIRE', key, 60)
return allowed
"""


async def acquire_token(tenant_id: str) -> bool:
    if is_breaker_open():
        return True  # fail open while Redis is out
    settings = get_settings()
    try:
        allowed = await get_redis().eval(  # type: ignore[no-untyped-call]
            _TOKEN_BUCKET_LUA,
            1,
            f"rate:{tenant_id}",
            settings.rate_limit_per_second,
            settings.rate_limit_per_second,
            int(time.time()),
        )
        return bool(int(allowed))
    except _REDIS_OFFLINE:
        trip_breaker()
        # Fail open — better to lose rate limiting than to drop a real invoice.
        return True


# ---------------------------------------------------------------------------
# Tiny key/value cache for hot rows
# ---------------------------------------------------------------------------


async def cache_get_json(key: str) -> dict[str, Any] | None:
    if is_breaker_open():
        return None
    try:
        raw = await get_redis().get(key)
    except _REDIS_OFFLINE:
        trip_breaker()
        return None
    return json.loads(raw) if raw else None


async def cache_set_json(key: str, value: dict[str, Any], ttl: int = 300) -> None:
    if is_breaker_open():
        return
    try:
        await get_redis().set(key, json.dumps(value, default=str), ex=ttl)
    except _REDIS_OFFLINE:
        trip_breaker()


async def cache_delete(key: str) -> None:
    if is_breaker_open():
        return
    try:
        await get_redis().delete(key)
    except _REDIS_OFFLINE:
        trip_breaker()
