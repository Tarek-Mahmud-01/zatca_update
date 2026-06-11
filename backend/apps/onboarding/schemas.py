from uuid import UUID
from datetime import datetime
from pydantic import BaseModel

class CsrConfigCreate(BaseModel):
    env: str = "sandbox"
    common_name: str
    serial_number: str
    organization_identifier: str
    organization_unit_name: str
    organization_name: str
    country_name: str = "SA"
    invoice_type: str = "1100"
    location_address: str
    industry_business_category: str

class CsrConfigRead(BaseModel):
    model_config = {"from_attributes": True}
    id: UUID
    tenant_id: UUID
    env: str
    common_name: str
    serial_number: str
    organization_identifier: str
    invoice_type: str
    created_at: datetime

class CsidRead(BaseModel):
    model_config = {"from_attributes": True}
    id: UUID
    tenant_id: UUID
    env: str
    kind: str
    certificate_pem: str | None
    binary_security_token: str | None
    request_id: str | None
    disposition_message: str | None
    issued_at: datetime | None
    compliance_passed_at: datetime | None
    is_dev: bool
    created_at: datetime

class ComplianceRequest(BaseModel):
    env: str = "sandbox"
    otp: str = "123456"
