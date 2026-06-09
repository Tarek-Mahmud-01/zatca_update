"""Consistent API response envelope.

Every successful response is { success, message, data, meta? }. Errors share the
same shape via the centralized exception handlers, so clients parse ONE format.
"""
from typing import Any, Generic, TypeVar

from pydantic import BaseModel

T = TypeVar("T")


class Meta(BaseModel):
    page: int
    size: int
    total: int
    total_pages: int


class Envelope(BaseModel, Generic[T]):
    success: bool = True
    message: str = "OK"
    data: T | None = None
    meta: Meta | None = None


def success(data: Any = None, message: str = "OK", meta: Meta | None = None) -> dict[str, Any]:
    body: dict[str, Any] = {"success": True, "message": message, "data": data}
    if meta is not None:
        body["meta"] = meta.model_dump()
    return body


def error(message: str, *, code: str, errors: Any = None) -> dict[str, Any]:
    return {"success": False, "message": message, "code": code, "errors": errors}
