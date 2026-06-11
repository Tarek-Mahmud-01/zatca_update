from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class BranchCreate(BaseModel):
    organization_id: UUID
    name: str
    code: str | None = None
    street: str | None = None
    building_number: str | None = None
    city_subdivision: str | None = None
    city: str | None = None
    postal_zone: str | None = None
    country_code: str = "SA"
    is_default: bool = False


class BranchUpdate(BaseModel):
    name: str | None = None
    code: str | None = None
    street: str | None = None
    building_number: str | None = None
    city_subdivision: str | None = None
    city: str | None = None
    postal_zone: str | None = None
    country_code: str | None = None
    is_default: bool | None = None


class BranchRead(BaseModel):
    model_config = {"from_attributes": True}

    id: UUID
    tenant_id: UUID
    organization_id: UUID
    name: str
    code: str | None
    street: str | None
    building_number: str | None
    city_subdivision: str | None
    city: str | None
    postal_zone: str | None
    country_code: str
    is_default: bool
    created_at: datetime
