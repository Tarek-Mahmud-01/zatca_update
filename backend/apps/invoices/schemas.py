from uuid import UUID
from datetime import datetime, date
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel


class PartySchema(BaseModel):
    registration_name: str
    vat_number: str | None = None
    crn: str | None = None
    street: str = ""
    building_number: str = ""
    city_subdivision: str = ""
    city: str = "Riyadh"
    postal_zone: str = "00000"
    country_code: str = "SA"


class InvoiceLineSchema(BaseModel):
    id: str = "1"
    name: str
    quantity: Decimal = Decimal("1")
    unit_code: str = "PCE"
    unit_price: Decimal
    tax_category: str = "S"
    tax_percent: Decimal = Decimal("15")
    discount_percent: Decimal = Decimal("0")


class InvoiceCreate(BaseModel):
    env: Literal["sandbox", "simulation", "production"] = "sandbox"
    doc_type: str = "standard_invoice"
    issue_date: date | None = None
    customer: PartySchema
    lines: list[InvoiceLineSchema]
    payment_means_code: str = "10"
    billing_reference_id: str | None = None
    instruction_note: str | None = None
    instruction_code: str | None = None
    notes: list[str] = []
    use_compliance_csid: bool = False
    submit: bool = True


class InvoiceRead(BaseModel):
    model_config = {"from_attributes": True}
    id: UUID
    tenant_id: UUID
    env: str
    uuid: UUID
    icv: int
    doc_type: str
    status: str
    invoice_hash: str | None
    qr_base64: str | None
    cleared_xml: str | None
    last_error: str | None
    signed_at: datetime | None
    submitted_at: datetime | None
    created_at: datetime


class InvoiceStatusCount(BaseModel):
    status: str
    count: int


class InvoiceStats(BaseModel):
    counts: list[InvoiceStatusCount]
