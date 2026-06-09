"""Settings business logic — per-user preferences (upsert semantics)."""
from collections.abc import Sequence
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from core.service import BaseService
from settings.exceptions import PreferenceNotFound
from settings.models import Preference
from settings.repository import PreferenceRepository
from settings.validators import validate_key


class SettingsService(BaseService):
    def __init__(self, db: AsyncSession) -> None:
        super().__init__(db)
        self.prefs = PreferenceRepository(db)

    async def list_preferences(self, user_id: UUID) -> Sequence[Preference]:
        return await self.prefs.list_for_user(user_id)

    async def upsert_preference(self, user_id: UUID, key: str, value: str) -> Preference:
        key = validate_key(key)
        existing = await self.prefs.get_by_user_key(user_id, key)
        if existing is not None:
            pref = await self.prefs.update(existing, value=value)
        else:
            pref = await self.prefs.create(user_id=user_id, key=key, value=value)
        await self.commit()
        return pref

    async def delete_preference(self, user_id: UUID, key: str) -> None:
        existing = await self.prefs.get_by_user_key(user_id, validate_key(key))
        if existing is None:
            raise PreferenceNotFound()
        await self.prefs.delete(existing)
        await self.commit()
