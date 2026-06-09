"""Preference repository."""
from collections.abc import Sequence
from uuid import UUID

from core.repository import BaseRepository
from settings.models import Preference


class PreferenceRepository(BaseRepository[Preference]):
    model = Preference

    async def list_for_user(self, user_id: UUID) -> Sequence[Preference]:
        return await self.list(Preference.user_id == user_id, order_by=[Preference.key.asc()])

    async def get_by_user_key(self, user_id: UUID, key: str) -> Preference | None:
        return await self.find_one(Preference.user_id == user_id, Preference.key == key)
