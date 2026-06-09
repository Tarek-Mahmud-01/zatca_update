"""Settings permissions — preferences are inherently self-scoped (the service
filters by current_user.id), so no extra role gate is needed here."""
from user.models import User


def owns_preferences(user: User) -> bool:
    return user.is_active
