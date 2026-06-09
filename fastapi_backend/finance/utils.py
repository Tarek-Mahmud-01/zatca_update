"""Finance helpers."""
from decimal import Decimal


def convert(amount: Decimal, rate: Decimal) -> Decimal:
    """Convert an amount using a 'units of base per 1 unit' exchange rate."""
    return (amount * rate).quantize(Decimal("0.01"))
