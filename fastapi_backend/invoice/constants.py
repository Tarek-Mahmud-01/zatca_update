"""Invoice app constants."""
from enum import StrEnum


class InvoiceStatus(StrEnum):
    DRAFT = "draft"
    ISSUED = "issued"
    PAID = "paid"
    CANCELLED = "cancelled"


ALLOWED_SORTS: frozenset[str] = frozenset({"created_at", "total_amount", "number"})
DEFAULT_SORT = "-created_at"
