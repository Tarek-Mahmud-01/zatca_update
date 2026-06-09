"""App-specific permission helpers (compose with core.permissions.require_roles)."""
from uuid import UUID

from user.constants import Role
from user.models import User
from core.exceptions import PermissionDeniedError


def ensure_self_or_admin(current: User, target_id: UUID) -> None:
    if current.role != Role.ADMIN and current.id != target_id:
        raise PermissionDeniedError("You can only access your own account.")
