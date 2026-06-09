"""Account schemas (self-service). Profile reads reuse the user app's UserRead."""
from pydantic import BaseModel, Field

from user.schemas import UserRead  # reuse — no duplicate shape

ProfileRead = UserRead


class ProfileUpdate(BaseModel):
    full_name: str = Field(min_length=1, max_length=200)


class ChangePassword(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)
