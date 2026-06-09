"""Invoice domain errors."""
from core.exceptions import ConflictError, ValidationError


class InvoiceNumberExists(ConflictError):
    code = "invoice_number_exists"
    message = "An invoice with this number already exists for this owner."


class EmptyInvoice(ValidationError):
    code = "empty_invoice"
    message = "An invoice must contain at least one line item."
