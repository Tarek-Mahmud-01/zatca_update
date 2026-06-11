from uuid import UUID

from app.repository import BaseRepository
from apps.auth.models import TenantUser


class TenantUserRepository(BaseRepository[TenantUser]):
    model = TenantUser

    async def get_by_id(self, user_id: UUID) -> TenantUser | None:
        return await self.get(user_id)
