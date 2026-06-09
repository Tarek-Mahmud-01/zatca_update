"""Invoice schemas. Read schemas use from_attributes over RELATIONSHIPS the
repository already eager-loaded — so serialization triggers zero extra queries.
"""
from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from invoice.constants import InvoiceStatus


class InvoiceItemCreate(BaseModel):
    description: str = Field(min_length=1, max_length=255)
    quantity: Decimal = Field(gt=0)
    unit_price: Decimal = Field(ge=0)


class InvoiceCreate(BaseModel):
    number: str = Field(min_length=1, max_length=64)
    currency: str = Field(default="SAR", min_length=3, max_length=3)
    notes: str | None = Field(default=None, max_length=500)
    items: list[InvoiceItemCreate] = Field(min_length=1)


class InvoiceStatusUpdate(BaseModel):
    status: InvoiceStatus


class OwnerBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    email: EmailStr
    full_name: str


class InvoiceItemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    description: str
    quantity: Decimal
    unit_price: Decimal
    line_total: Decimal


class InvoiceListItem(BaseModel):
    """Lightweight row for list endpoints — owner joined, items NOT loaded."""
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    number: str
    status: str
    currency: str
    total_amount: Decimal
    created_at: datetime
    owner: OwnerBrief


class InvoiceRead(InvoiceListItem):
    """Detail — adds the eager-loaded line items."""
    notes: str | None = None
    items: list[InvoiceItemRead]


class StatusBucket(BaseModel):
    status: str
    count: int
    total: Decimal


class InvoiceStats(BaseModel):
    by_status: list[StatusBucket]
    total_count: int
    grand_total: Decimal
