"""Invoice validation + sort-key whitelisting (prevents arbitrary ORDER BY)."""
from invoice.constants import ALLOWED_SORTS, DEFAULT_SORT
from core.exceptions import ValidationError


def validate_currency(code: str) -> str:
    code = code.strip().upper()
    if len(code) != 3 or not code.isalpha():
        raise ValidationError("Currency must be a 3-letter ISO 4217 code.", code="invalid_currency")
    return code


def normalize_sort(sort: str | None) -> str:
    if not sort:
        return DEFAULT_SORT
    field = sort.lstrip("-")
    if field not in ALLOWED_SORTS:
        raise ValidationError(
            f"Cannot sort by '{field}'. Allowed: {', '.join(sorted(ALLOWED_SORTS))}.",
            code="invalid_sort",
        )
    return sort
