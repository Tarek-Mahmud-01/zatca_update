"""Account helpers."""
from user.models import User


def initials(user: User) -> str:
    name = user.full_name.strip() or user.email
    parts = name.split()
    return (parts[0][:1] + (parts[-1][:1] if len(parts) > 1 else "")).upper()
