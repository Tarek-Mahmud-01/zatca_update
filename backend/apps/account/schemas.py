from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ProfileRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    email: str
    role: str
    page_size: int
    tenant_id: UUID
    created_at: datetime


class ProfileUpdate(BaseModel):
    page_size: int = Field(default=25, ge=10, le=200)


class ChangePassword(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)
