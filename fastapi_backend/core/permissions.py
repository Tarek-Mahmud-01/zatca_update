"""RBAC permission dependencies.

`require_roles("admin")` returns a dependency that authenticates the user AND
checks their role — use it in `dependencies=[...]` on a route or as a param when
you need the user object back.
"""
from collections.abc import Callable, Coroutine
from typing import Any

from fastapi import Depends

from user.models import User
from core.deps import get_current_user
from core.exceptions import PermissionDeniedError


def require_roles(*roles: str) -> Callable[..., Coroutine[Any, Any, User]]:
    async def dependency(user: User = Depends(get_current_user)) -> User:
        if roles and user.role not in roles:
            raise PermissionDeniedError(
                f"This action requires one of roles: {', '.join(roles)}."
            )
        return user

    return dependency
