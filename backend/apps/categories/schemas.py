from uuid import UUID
from datetime import datetime
from pydantic import BaseModel

class CategoryCreate(BaseModel):
    name: str
    description: str | None = None

class CategoryUpdate(BaseModel):
    name: str | None = None
    description: str | None = None

class CategoryRead(BaseModel):
    model_config = {"from_attributes": True}
    id: UUID
    tenant_id: UUID
    name: str
    description: str | None
    created_at: datetime
