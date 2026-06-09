"""Pagination params + paginated payload helper.

`PageParams` is a FastAPI dependency (validated query params). `paginate` pairs a
page of rows with a single COUNT so the meta block is consistent everywhere.
"""
from dataclasses import dataclass
from typing import Any, Sequence

from fastapi import Depends, Query

from core.config import get_settings
from core.responses import Meta, success

_settings = get_settings()


@dataclass(frozen=True)
class PageParams:
    page: int
    size: int

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.size

    @property
    def limit(self) -> int:
        return self.size


def pagination_params(
    page: int = Query(1, ge=1, description="1-based page number"),
    size: int = Query(
        _settings.default_page_size, ge=1, le=_settings.max_page_size, description="Items per page"
    ),
) -> PageParams:
    return PageParams(page=page, size=size)


PageParamsDep = Depends(pagination_params)


def paginate(items: Sequence[Any], total: int, params: PageParams, message: str = "OK") -> dict[str, Any]:
    total_pages = (total + params.size - 1) // params.size if params.size else 1
    meta = Meta(page=params.page, size=params.size, total=total, total_pages=max(total_pages, 1))
    return success(data=items, message=message, meta=meta)
