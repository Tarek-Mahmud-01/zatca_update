"""Invoice authorization helpers."""
from uuid import UUID

from user.constants import Role
from user.models import User
from core.exceptions import PermissionDeniedError


def ensure_owner_or_admin(user: User, owner_id: UUID) -> None:
    if user.role != Role.ADMIN and user.id != owner_id:
        raise PermissionDeniedError("You can only access your own invoices.")


def is_admin(user: User) -> bool:
    return user.role == Role.ADMIN
