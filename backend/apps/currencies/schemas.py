from uuid import UUID
from datetime import datetime, date
from decimal import Decimal

from pydantic import BaseModel


class CurrencyCreate(BaseModel):
    code: str  # ISO 4217 (3-char)
    exchange_rate: Decimal = Decimal("1.0")
    as_of_date: date | None = None  # defaults to today on the server
    is_default: bool = False


class CurrencyUpdate(BaseModel):
    exchange_rate: Decimal | None = None
    as_of_date: date | None = None
    is_default: bool | None = None


class CurrencyRead(BaseModel):
    model_config = {"from_attributes": True}

    id: UUID
    tenant_id: UUID
    code: str
    exchange_rate: Decimal
    as_of_date: date
    is_default: bool
    created_at: datetime
