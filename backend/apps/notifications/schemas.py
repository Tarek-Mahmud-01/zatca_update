from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class WebhookCreate(BaseModel):
    url: str
    secret: str | None = None  # auto-generated if not provided
    events: list[str]
    enabled: bool = True


class WebhookUpdate(BaseModel):
    url: str | None = None
    secret: str | None = None
    events: list[str] | None = None
    enabled: bool | None = None


class WebhookRead(BaseModel):
    model_config = {"from_attributes": True}

    id: UUID
    tenant_id: UUID
    url: str
    secret: str
    events: list[str]
    enabled: bool
    created_at: datetime
