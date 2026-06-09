"""User app constants — roles drive RBAC."""
from enum import StrEnum


class Role(StrEnum):
    ADMIN = "admin"
    MANAGER = "manager"
    STAFF = "staff"


ALL_ROLES: tuple[str, ...] = tuple(r.value for r in Role)
DEFAULT_ROLE: str = Role.STAFF.value
