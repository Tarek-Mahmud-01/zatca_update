"""Settings schemas."""
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from settings.constants import MAX_VALUE_LENGTH


class PreferenceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    key: str
    value: str
    updated_at: datetime


class PreferenceValue(BaseModel):
    value: str = Field(max_length=MAX_VALUE_LENGTH)
