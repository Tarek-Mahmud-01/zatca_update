"""User-app domain errors (extend the shared base → centralized handling)."""
from core.exceptions import AuthenticationError, ConflictError


class EmailAlreadyExists(ConflictError):
    code = "email_exists"
    message = "A user with this email already exists."


class InvalidCredentials(AuthenticationError):
    code = "invalid_credentials"
    message = "Incorrect email or password."
