"""Cross-app constants. App-specific constants live in each app's constants.py."""
from enum import StrEnum


class SortOrder(StrEnum):
    ASC = "asc"
    DESC = "desc"


# Centralized cache TTLs (seconds) so they're tuned in one place.
class CacheTTL:
    SHORT = 30
    MEDIUM = 300
    LONG = 3600
