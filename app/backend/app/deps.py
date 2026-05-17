from typing import Annotated
from uuid import UUID

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.security import decode_access_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login", auto_error=True)

DbSession = Annotated[AsyncSession, Depends(get_db)]


class CurrentUser:
    __slots__ = ("user_id", "tenant_id", "role")

    def __init__(self, user_id: UUID, tenant_id: UUID, role: str) -> None:
        self.user_id = user_id
        self.tenant_id = tenant_id
        self.role = role


def current_user(token: Annotated[str, Depends(oauth2_scheme)]) -> CurrentUser:
    try:
        payload = decode_access_token(token)
    except ValueError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid_token")
    return CurrentUser(
        user_id=UUID(payload["sub"]),
        tenant_id=UUID(payload["tid"]),
        role=payload["role"],
    )


CurrentUserDep = Annotated[CurrentUser, Depends(current_user)]
