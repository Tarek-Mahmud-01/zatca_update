"""Finance permissions (writes are admin-only; enforced in urls via require_roles)."""
from user.constants import Role
from user.models import User


def can_manage_finance(user: User) -> bool:
    return user.role == Role.ADMIN
