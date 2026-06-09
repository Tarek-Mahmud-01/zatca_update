"""Password hashing + JWT issue/verify. No DB, no framework — pure functions."""
from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
from jose import JWTError, jwt

from core.config import get_settings

_settings = get_settings()

ACCESS = "access"
REFRESH = "refresh"


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8")[:72], bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8")[:72], hashed.encode())
    except ValueError:
        return False


def _create_token(subject: str, token_type: str, expires_delta: timedelta, **claims: Any) -> str:
    payload = {
        "sub": subject,
        "type": token_type,
        "exp": datetime.now(timezone.utc) + expires_delta,
        "iat": datetime.now(timezone.utc),
        **claims,
    }
    return jwt.encode(payload, _settings.secret_key, algorithm=_settings.jwt_algorithm)


def create_access_token(subject: str, **claims: Any) -> str:
    return _create_token(
        subject, ACCESS, timedelta(minutes=_settings.access_token_expire_minutes), **claims
    )


def create_refresh_token(subject: str, **claims: Any) -> str:
    return _create_token(
        subject, REFRESH, timedelta(days=_settings.refresh_token_expire_days), **claims
    )


def decode_token(token: str) -> dict[str, Any]:
    try:
        return jwt.decode(token, _settings.secret_key, algorithms=[_settings.jwt_algorithm])
    except JWTError as exc:
        raise ValueError("invalid_token") from exc
