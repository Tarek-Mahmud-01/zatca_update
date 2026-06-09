"""Finance validators."""
from core.exceptions import ValidationError


def validate_currency_code(code: str) -> str:
    code = code.strip().upper()
    if len(code) != 3 or not code.isalpha():
        raise ValidationError("Currency code must be 3 letters (ISO 4217).", code="invalid_currency")
    return code
