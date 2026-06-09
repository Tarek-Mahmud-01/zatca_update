"""Settings helpers."""
from collections.abc import Sequence

from settings.models import Preference


def to_dict(prefs: Sequence[Preference]) -> dict[str, str]:
    """Collapse a user's preference rows into a flat {key: value} map."""
    return {p.key: p.value for p in prefs}
