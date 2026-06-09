"""Finance domain errors."""
from core.exceptions import ConflictError, NotFoundError


class CurrencyExists(ConflictError):
    code = "currency_exists"
    message = "A currency with this code already exists."


class CurrencyNotFound(NotFoundError):
    code = "currency_not_found"
    message = "Currency not found."
