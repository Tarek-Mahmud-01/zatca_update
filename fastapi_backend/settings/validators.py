"""Settings validators."""
import re

from core.exceptions import ValidationError
from settings.constants import MAX_KEY_LENGTH

_KEY_RE = re.compile(r"^[a-z0-9_.]{1,%d}$" % MAX_KEY_LENGTH)


def validate_key(key: str) -> str:
    key = key.strip().lower()
    if not _KEY_RE.match(key):
        raise ValidationError(
            "Preference key may contain a-z, 0-9, '_' and '.' only.", code="invalid_key"
        )
    return key
