"""Account permissions — every endpoint acts on the caller's own record, so
authentication (current-user dependency) is the only gate required."""
from user.models import User


def is_self_service(user: User) -> bool:
    return user.is_active
