"""Pure unit tests for the validation layer — no DB, no app, fully isolated."""
import pytest

from invoice.constants import DEFAULT_SORT
from invoice.validators import normalize_sort, validate_currency
from core.exceptions import ValidationError


def test_validate_currency_uppercases() -> None:
    assert validate_currency("sar") == "SAR"


@pytest.mark.parametrize("bad", ["SARX", "12", "S$R"])
def test_validate_currency_rejects_bad(bad: str) -> None:
    with pytest.raises(ValidationError):
        validate_currency(bad)


def test_normalize_sort_defaults() -> None:
    assert normalize_sort(None) == DEFAULT_SORT


def test_normalize_sort_allows_known_descending() -> None:
    assert normalize_sort("-total_amount") == "-total_amount"


def test_normalize_sort_rejects_unknown() -> None:
    with pytest.raises(ValidationError):
        normalize_sort("password")
