from app.exceptions import ValidationError


def validate_password_strength(password: str) -> None:
    if len(password) < 8:
        raise ValidationError("Password must be at least 8 characters.", code="weak_password")
