"""Settings domain errors."""
from core.exceptions import NotFoundError


class PreferenceNotFound(NotFoundError):
    code = "preference_not_found"
    message = "Preference not found."
