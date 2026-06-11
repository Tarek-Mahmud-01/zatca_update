from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.security import hash_password, verify_password
from app.service import BaseService
from apps.account.exceptions import WrongCurrentPassword
from apps.account.repository import TenantUserRepository
from apps.account.validators import validate_password_strength
from apps.auth.models import TenantUser


class AccountService(BaseService):
    def __init__(self, db: AsyncSession) -> None:
        super().__init__(db)
        self.users = TenantUserRepository(db)

    async def get_profile(self, user_id: UUID) -> TenantUser:
        return await self.users.get_or_404(user_id)

    async def update_profile(self, user: TenantUser, page_size: int) -> TenantUser:
        await self.users.update(user, page_size=page_size)
        await self.commit()
        return user

    async def change_password(self, user: TenantUser, current_password: str, new_password: str) -> None:
        if not verify_password(current_password, user.hashed_password):
            raise WrongCurrentPassword()
        validate_password_strength(new_password)
        await self.users.update(user, hashed_password=hash_password(new_password))
        await self.commit()
