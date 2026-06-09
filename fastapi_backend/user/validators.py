"""Reusable validation helpers beyond what Pydantic field rules cover.

Schema-level rules live on the schemas; cross-field / policy validation that the
service needs lives here so it's testable in isolation.
"""
import re

from core.exceptions import ValidationError

_PASSWORD_RULES = re.compile(r"^(?=.*[A-Za-z])(?=.*\d).{8,128}$")


def normalize_email(email: str) -> str:
    return email.strip().lower()


def validate_password_strength(password: str) -> None:
    if not _PASSWORD_RULES.match(password):
        raise ValidationError(
            "Password must be 8-128 chars and include at least one letter and one digit.",
            code="weak_password",
        )
