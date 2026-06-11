from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel


class ProductCreate(BaseModel):
    category_id: UUID | None = None
    sku: str
    name: str
    description: str | None = None
    unit_price: Decimal
    unit_code: str = "PCE"
    tax_category: str = "S"
    tax_percent: Decimal = Decimal("15")


class ProductUpdate(BaseModel):
    category_id: UUID | None = None
    sku: str | None = None
    name: str | None = None
    description: str | None = None
    unit_price: Decimal | None = None
    unit_code: str | None = None
    tax_category: str | None = None
    tax_percent: Decimal | None = None


class ProductRead(BaseModel):
    model_config = {"from_attributes": True}

    id: UUID
    tenant_id: UUID
    category_id: UUID | None
    sku: str
    name: str
    description: str | None
    unit_price: Decimal
    unit_code: str
    tax_category: str
    tax_percent: Decimal
    created_at: datetime
