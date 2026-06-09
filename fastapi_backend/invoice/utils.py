"""Invoice helpers."""
from decimal import Decimal

_TWOPLACES = Decimal("0.01")


def money(value: Decimal | int | float | str) -> Decimal:
    return Decimal(str(value)).quantize(_TWOPLACES)
