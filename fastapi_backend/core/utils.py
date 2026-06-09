"""Small, reusable, dependency-free helpers shared across apps."""
from typing import Any, Sequence, TypeVar

T = TypeVar("T")
K = TypeVar("K")


def index_by(items: Sequence[T], key: str) -> dict[Any, T]:
    """Map a list of objects by an attribute — replaces per-item DB lookups."""
    return {getattr(item, key): item for item in items}


def group_by(items: Sequence[T], key: str) -> dict[Any, list[T]]:
    out: dict[Any, list[T]] = {}
    for item in items:
        out.setdefault(getattr(item, key), []).append(item)
    return out


def clamp(value: int, low: int, high: int) -> int:
    return max(low, min(value, high))
