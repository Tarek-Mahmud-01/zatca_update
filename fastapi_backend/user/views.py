"""View handlers — thin. Each does: parse (via schema) → call ONE service method
→ wrap in the response envelope. No business logic, no ORM here.
"""
from uuid import UUID

from fastapi import Depends

from user.schemas import (
    LoginRequest,
    RefreshRequest,
    UserCreate,
    UserRead,
    UserUpdate,
)
from user.service import UserService
from core.deps import CurrentUser, DbSession
from core.pagination import PageParams, pagination_params, paginate
from core.responses import success


async def register(payload: UserCreate, db: DbSession) -> dict:
    user = await UserService(db).register(payload)
    return success(UserRead.model_validate(user).model_dump(mode="json"), message="Registered.")


async def login(payload: LoginRequest, db: DbSession) -> dict:
    tokens = await UserService(db).authenticate(payload)
    return success(tokens.model_dump(), message="Login successful.")


async def refresh(payload: RefreshRequest, db: DbSession) -> dict:
    tokens = await UserService(db).refresh(payload.refresh_token)
    return success(tokens.model_dump(), message="Token refreshed.")


async def me(current_user: CurrentUser) -> dict:
    return success(UserRead.model_validate(current_user).model_dump(mode="json"))


async def list_users(
    db: DbSession,
    params: PageParams = Depends(pagination_params),
) -> dict:
    rows, total = await UserService(db).list_users(params)
    data = [UserRead.model_validate(u).model_dump(mode="json") for u in rows]
    return paginate(data, total, params)


async def get_user(user_id: UUID, db: DbSession) -> dict:
    user = await UserService(db).get_user(user_id)
    return success(UserRead.model_validate(user).model_dump(mode="json"))


async def update_user(user_id: UUID, payload: UserUpdate, db: DbSession) -> dict:
    user = await UserService(db).update_user(user_id, payload)
    return success(UserRead.model_validate(user).model_dump(mode="json"), message="Updated.")


async def delete_user(user_id: UUID, db: DbSession) -> dict:
    await UserService(db).delete_user(user_id)
    return success(message="Deleted.")
