"""Shared FastAPI dependencies: DB session + JWT-authenticated current user."""
from typing import Annotated

from fastapi import Depends
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession

from user.models import User
from user.repository import UserRepository
from core.database import get_db
from core.exceptions import AuthenticationError
from core.security import ACCESS, decode_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/users/login")

DbSession = Annotated[AsyncSession, Depends(get_db)]


async def get_current_user(
    token: Annotated[str, Depends(oauth2_scheme)],
    db: DbSession,
) -> User:
    try:
        payload = decode_token(token)
    except ValueError as exc:
        raise AuthenticationError("Invalid or expired token.") from exc
    if payload.get("type") != ACCESS:
        raise AuthenticationError("Wrong token type.")
    user = await UserRepository(db).get(payload.get("sub"))
    if user is None or not user.is_active:
        raise AuthenticationError("User not found or inactive.")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
