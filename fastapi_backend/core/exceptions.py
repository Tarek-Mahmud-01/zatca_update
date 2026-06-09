"""Domain exception hierarchy. Services raise these; the centralized handlers
(`exception_handlers.py`) translate them into the consistent error envelope.

Keeping a single base (`AppException`) means views never build error responses
by hand and never leak raw tracebacks.
"""
from typing import Any


class AppException(Exception):
    status_code: int = 400
    code: str = "app_error"
    message: str = "Application error."

    def __init__(
        self,
        message: str | None = None,
        *,
        code: str | None = None,
        status_code: int | None = None,
        errors: Any = None,
    ) -> None:
        self.message = message or self.message
        self.code = code or self.code
        self.status_code = status_code or self.status_code
        self.errors = errors
        super().__init__(self.message)


class NotFoundError(AppException):
    status_code = 404
    code = "not_found"
    message = "Resource not found."


class ValidationError(AppException):
    status_code = 422
    code = "validation_error"
    message = "Validation failed."


class AuthenticationError(AppException):
    status_code = 401
    code = "authentication_error"
    message = "Authentication failed."


class PermissionDeniedError(AppException):
    status_code = 403
    code = "permission_denied"
    message = "You do not have permission to perform this action."


class ConflictError(AppException):
    status_code = 409
    code = "conflict"
    message = "Resource conflict."
