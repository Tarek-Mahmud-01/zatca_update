from datetime import datetime, timedelta, timezone
from uuid import UUID

import bcrypt
from jose import JWTError, jwt

from app.config import get_settings

settings = get_settings()


def hash_password(password: str) -> str:
    # bcrypt truncates >72 bytes silently; pre-truncate to keep verify symmetrical.
    return bcrypt.hashpw(password.encode("utf-8")[:72], bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8")[:72], hashed.encode())
    except ValueError:
        return False


def create_access_token(user_id: UUID, tenant_id: UUID, role: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expires_minutes)
    payload = {
        "sub": str(user_id),
        "tid": str(tenant_id),
        "role": role,
        "exp": expire,
    }
    return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.secret_key, algorithms=[settings.jwt_algorithm])
    except JWTError as e:
        raise ValueError("invalid token") from e


# ── SSE stream tickets ────────────────────────────────────────────────────────
# A ticket is a tiny, short-lived JWT carrying typ="sse". It exists only so the
# browser can authenticate an EventSource connection (which can't set headers)
# without putting the long-lived API token in the URL. The distinct typ means a
# leaked ticket can't be replayed against the regular API (current_user rejects
# typ="sse"), and a regular API token can't be used to open the stream.
SSE_TICKET_TYPE = "sse"


def create_sse_ticket(user_id: UUID | str, tenant_id: UUID | str, role: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(seconds=settings.sse_ticket_ttl_seconds)
    payload = {
        "sub": str(user_id),
        "tid": str(tenant_id),
        "role": role,
        "typ": SSE_TICKET_TYPE,
        "exp": expire,
    }
    return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)


def decode_sse_ticket(token: str) -> dict:
    """Decode a stream ticket, rejecting anything that isn't a genuine SSE ticket."""
    payload = decode_access_token(token)
    if payload.get("typ") != SSE_TICKET_TYPE:
        raise ValueError("not an sse ticket")
    return payload
