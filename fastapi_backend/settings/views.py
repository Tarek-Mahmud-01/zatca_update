"""Settings view handlers — all scoped to the authenticated user."""
from core.deps import CurrentUser, DbSession
from core.responses import success
from settings.schemas import PreferenceRead, PreferenceValue
from settings.service import SettingsService


async def list_preferences(db: DbSession, current_user: CurrentUser) -> dict:
    rows = await SettingsService(db).list_preferences(current_user.id)
    return success([PreferenceRead.model_validate(r).model_dump(mode="json") for r in rows])


async def upsert_preference(
    key: str, payload: PreferenceValue, db: DbSession, current_user: CurrentUser
) -> dict:
    pref = await SettingsService(db).upsert_preference(current_user.id, key, payload.value)
    return success(PreferenceRead.model_validate(pref).model_dump(mode="json"), message="Saved.")


async def delete_preference(key: str, db: DbSession, current_user: CurrentUser) -> dict:
    await SettingsService(db).delete_preference(current_user.id, key)
    return success(message="Deleted.")
