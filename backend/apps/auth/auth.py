"""JWT auth + password hashing, ported from the FastAPI `app/security.py`.

Tokens carry `sub` (user_id), `tid` (tenant_id), `role`, `exp` — same claim
shape as before so the frontend contract is unchanged. SSE tickets add
`typ="sse"` and a short TTL (they ride in the EventSource URL, which can't send
auth headers).
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from django.conf import settings
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed


# ---- password hashing (bcrypt, 72-byte pre-truncate) ----------------------
def hash_password(plain: str) -> str:
    pw = plain.encode("utf-8")[:72]
    return bcrypt.hashpw(pw, bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8")[:72], hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


# ---- JWT mint / decode ----------------------------------------------------
def _encode(claims: dict, ttl_minutes: float) -> str:
    payload = {**claims, "exp": datetime.now(timezone.utc) + timedelta(minutes=ttl_minutes)}
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def create_access_token(user_id, tenant_id, role: str) -> str:
    return _encode(
        {"sub": str(user_id), "tid": str(tenant_id), "role": role},
        settings.JWT_EXPIRES_MINUTES,
    )


def decode_access_token(token: str) -> dict:
    payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
    if payload.get("typ") == "sse":
        raise jwt.InvalidTokenError("sse ticket not valid for API")
    return payload


def create_sse_ticket(user_id, tenant_id, role: str) -> str:
    return _encode(
        {"sub": str(user_id), "tid": str(tenant_id), "role": role, "typ": "sse"},
        settings.SSE_TICKET_TTL_SECONDS / 60.0,
    )


def decode_sse_ticket(token: str) -> dict:
    payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
    if payload.get("typ") != "sse":
        raise jwt.InvalidTokenError("not an sse ticket")
    return payload


# ---- DRF authentication ---------------------------------------------------
@dataclass
class Principal:
    """Lightweight authenticated principal (no DB row) carrying the JWT claims.
    Set as `request.user`; DRF's IsAuthenticated needs `is_authenticated`."""
    user_id: str
    tenant_id: str
    role: str

    @property
    def is_authenticated(self) -> bool:
        return True


class JWTAuthentication(BaseAuthentication):
    keyword = "Bearer"

    def authenticate(self, request):
        header = request.headers.get("Authorization", "")
        if not header.startswith(self.keyword + " "):
            return None
        token = header[len(self.keyword) + 1:].strip()
        try:
            payload = decode_access_token(token)
        except jwt.PyJWTError:
            raise AuthenticationFailed("invalid or expired token")
        principal = Principal(
            user_id=payload["sub"], tenant_id=payload["tid"], role=payload.get("role", "member"),
        )
        return (principal, payload)
