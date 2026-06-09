"""Account business logic — self-service over the user app's repository (reuse)."""
from sqlalchemy.ext.asyncio import AsyncSession

from account.exceptions import WrongCurrentPassword
from core.security import hash_password, verify_password
from core.service import BaseService
from user.models import User
from user.repository import UserRepository
from user.validators import validate_password_strength


class AccountService(BaseService):
    def __init__(self, db: AsyncSession) -> None:
        super().__init__(db)
        self.users = UserRepository(db)  # reuse, don't duplicate

    async def update_profile(self, user: User, full_name: str) -> User:
        await self.users.update(user, full_name=full_name)
        await self.commit()
        return user

    async def change_password(self, user: User, current_password: str, new_password: str) -> None:
        if not verify_password(current_password, user.hashed_password):
            raise WrongCurrentPassword()
        validate_password_strength(new_password)
        await self.users.update(user, hashed_password=hash_password(new_password))
        await self.commit()
