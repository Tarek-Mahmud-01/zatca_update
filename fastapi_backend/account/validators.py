"""Account validators — reuse the user app's password policy (no duplication)."""
from user.validators import validate_password_strength

__all__ = ["validate_password_strength"]
