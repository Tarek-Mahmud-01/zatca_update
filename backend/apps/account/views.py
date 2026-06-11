from app.db.session import get_db
from app.deps import CurrentUserDep, DbSession
from apps.account.schemas import ChangePassword, ProfileRead, ProfileUpdate
from apps.account.service import AccountService


async def get_profile(current_user: CurrentUserDep, db: DbSession) -> dict:
    user = await AccountService(db).get_profile(current_user.user_id)
    return ProfileRead.model_validate(user).model_dump(mode="json")


async def update_profile(payload: ProfileUpdate, db: DbSession, current_user: CurrentUserDep) -> dict:
    user = await AccountService(db).get_profile(current_user.user_id)
    user = await AccountService(db).update_profile(user, payload.page_size)
    return ProfileRead.model_validate(user).model_dump(mode="json")


async def change_password(payload: ChangePassword, db: DbSession, current_user: CurrentUserDep) -> dict:
    user = await AccountService(db).get_profile(current_user.user_id)
    await AccountService(db).change_password(user, payload.current_password, payload.new_password)
    return {"message": "Password changed."}
