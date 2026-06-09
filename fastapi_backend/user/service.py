"""User business logic. Views call these methods; all rules live here."""
from collections.abc import Sequence
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from user.constants import Role
from user.exceptions import EmailAlreadyExists, InvalidCredentials
from user.models import User
from user.repository import UserRepository
from user.schemas import LoginRequest, TokenPair, UserCreate, UserUpdate
from user.validators import normalize_email, validate_password_strength
from core.pagination import PageParams
from core.security import (
    REFRESH,
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)
from core.service import BaseService


class UserService(BaseService):
    def __init__(self, db: AsyncSession) -> None:
        super().__init__(db)
        self.users = UserRepository(db)

    # -- auth ----------------------------------------------------------------
    async def register(self, payload: UserCreate) -> User:
        email = normalize_email(payload.email)
        validate_password_strength(payload.password)
        if await self.users.email_exists(email):
            raise EmailAlreadyExists()
        user = await self.users.create(
            email=email,
            hashed_password=hash_password(payload.password),
            full_name=payload.full_name,
            role=payload.role.value,
        )
        await self.commit()
        return user

    async def authenticate(self, payload: LoginRequest) -> TokenPair:
        user = await self.users.get_by_email(normalize_email(payload.email))
        if user is None or not verify_password(payload.password, user.hashed_password):
            raise InvalidCredentials()
        if not user.is_active:
            raise InvalidCredentials("Account is disabled.")
        return self._issue_tokens(user)

    async def refresh(self, refresh_token: str) -> TokenPair:
        try:
            payload = decode_token(refresh_token)
        except ValueError as exc:
            raise InvalidCredentials("Invalid refresh token.") from exc
        if payload.get("type") != REFRESH:
            raise InvalidCredentials("Not a refresh token.")
        user = await self.users.get(payload.get("sub"))
        if user is None or not user.is_active:
            raise InvalidCredentials("User no longer active.")
        return self._issue_tokens(user)

    @staticmethod
    def _issue_tokens(user: User) -> TokenPair:
        claims = {"role": user.role, "email": user.email}
        return TokenPair(
            access_token=create_access_token(str(user.id), **claims),
            refresh_token=create_refresh_token(str(user.id)),
        )

    # -- crud ----------------------------------------------------------------
    async def list_users(self, params: PageParams) -> tuple[Sequence[User], int]:
        rows = await self.users.list(
            order_by=[User.created_at.desc()], limit=params.limit, offset=params.offset
        )
        total = await self.users.count()
        return rows, total

    async def get_user(self, user_id: UUID) -> User:
        return await self.users.get_or_404(user_id)

    async def update_user(self, user_id: UUID, payload: UserUpdate) -> User:
        user = await self.users.get_or_404(user_id)
        data = payload.model_dump(exclude_unset=True)
        if "role" in data and isinstance(data["role"], Role):
            data["role"] = data["role"].value
        user = await self.users.update(user, **data)
        await self.commit()
        return user

    async def delete_user(self, user_id: UUID) -> None:
        user = await self.users.get_or_404(user_id)
        await self.users.delete(user)
        await self.commit()
