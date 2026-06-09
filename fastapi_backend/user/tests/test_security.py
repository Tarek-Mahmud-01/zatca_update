"""Unit tests for password hashing, JWT round-trip, and validators."""
import pytest

from user.validators import normalize_email, validate_password_strength
from core.exceptions import ValidationError
from core.security import (
    ACCESS,
    create_access_token,
    decode_token,
    hash_password,
    verify_password,
)


def test_password_hash_roundtrip() -> None:
    hashed = hash_password("Secret123")
    assert verify_password("Secret123", hashed)
    assert not verify_password("wrong", hashed)


def test_access_token_roundtrip() -> None:
    token = create_access_token("user-123", role="admin")
    payload = decode_token(token)
    assert payload["sub"] == "user-123"
    assert payload["type"] == ACCESS
    assert payload["role"] == "admin"


def test_decode_invalid_token_raises() -> None:
    with pytest.raises(ValueError):
        decode_token("not-a-jwt")


def test_normalize_email() -> None:
    assert normalize_email("  USER@Example.COM ") == "user@example.com"


@pytest.mark.parametrize("weak", ["short", "onlyletters", "12345678"])
def test_weak_passwords_rejected(weak: str) -> None:
    with pytest.raises(ValidationError):
        validate_password_strength(weak)
