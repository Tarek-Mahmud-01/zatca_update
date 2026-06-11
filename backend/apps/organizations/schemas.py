from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class OrgCreate(BaseModel):
    name: str
    trade_name: str | None = None
    vat_number: str | None = None
    registration_number: str | None = None
    street: str | None = None
    building_number: str | None = None
    city_subdivision: str | None = None
    city: str | None = None
    postal_zone: str | None = None
    country_code: str = Field(default="SA", max_length=2)
    is_default: bool = False


class OrgUpdate(BaseModel):
    name: str | None = None
    trade_name: str | None = None
    vat_number: str | None = None
    registration_number: str | None = None
    street: str | None = None
    building_number: str | None = None
    city_subdivision: str | None = None
    city: str | None = None
    postal_zone: str | None = None
    country_code: str | None = Field(default=None, max_length=2)
    is_default: bool | None = None


class OrgRead(BaseModel):
    model_config = {"from_attributes": True}

    id: UUID
    tenant_id: UUID
    name: str
    trade_name: str | None
    vat_number: str | None
    registration_number: str | None
    street: str | None
    building_number: str | None
    city_subdivision: str | None
    city: str | None
    postal_zone: str | None
    country_code: str
    is_default: bool
    created_at: datetime
