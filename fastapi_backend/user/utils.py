"""User-app helpers."""
from user.models import User


def display_name(user: User) -> str:
    return user.full_name.strip() or user.email.split("@")[0]
