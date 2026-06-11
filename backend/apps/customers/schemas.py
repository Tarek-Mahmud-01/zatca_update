from uuid import UUID
from datetime import datetime
from pydantic import BaseModel


class CustomerCreate(BaseModel):
    external_id: str | None = None
    name: str
    vat_number: str | None = None
    crn: str | None = None
    email: str | None = None
    phone: str | None = None
    street: str = ""
    building_number: str = ""
    city_subdivision: str = ""
    city: str = ""
    postal_zone: str = ""
    country_code: str = "SA"


class CustomerUpdate(BaseModel):
    name: str | None = None
    vat_number: str | None = None
    crn: str | None = None
    email: str | None = None
    phone: str | None = None
    street: str | None = None
    building_number: str | None = None
    city_subdivision: str | None = None
    city: str | None = None
    postal_zone: str | None = None
    country_code: str | None = None


class CustomerRead(BaseModel):
    model_config = {"from_attributes": True}

    id: UUID
    tenant_id: UUID
    external_id: str | None
    name: str
    vat_number: str | None
    crn: str | None
    email: str | None
    phone: str | None
    street: str
    building_number: str
    city_subdivision: str
    city: str
    postal_zone: str
    country_code: str
    created_at: datetime
