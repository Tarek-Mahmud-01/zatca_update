"""Account view handlers — operate on the authenticated user (self-service)."""
from account.schemas import ChangePassword, ProfileRead, ProfileUpdate
from account.service import AccountService
from core.deps import CurrentUser, DbSession
from core.responses import success


async def get_profile(current_user: CurrentUser) -> dict:
    return success(ProfileRead.model_validate(current_user).model_dump(mode="json"))


async def update_profile(payload: ProfileUpdate, db: DbSession, current_user: CurrentUser) -> dict:
    user = await AccountService(db).update_profile(current_user, payload.full_name)
    return success(ProfileRead.model_validate(user).model_dump(mode="json"), message="Profile updated.")


async def change_password(payload: ChangePassword, db: DbSession, current_user: CurrentUser) -> dict:
    await AccountService(db).change_password(
        current_user, payload.current_password, payload.new_password
    )
    return success(message="Password changed.")
