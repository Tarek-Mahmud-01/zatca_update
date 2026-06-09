"""Finance schemas."""
from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class CurrencyCreate(BaseModel):
    code: str = Field(min_length=3, max_length=3)
    name: str = Field(default="", max_length=100)
    is_default: bool = False


class CurrencyRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    code: str
    name: str
    is_default: bool
    created_at: datetime


class ExchangeRateCreate(BaseModel):
    currency_id: UUID
    rate: Decimal = Field(gt=0)
    as_of_date: date


class CurrencyBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    code: str


class ExchangeRateRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    rate: Decimal
    as_of_date: date
    currency: CurrencyBrief
