"""Settings background tasks (Celery)."""
from core.celery_app import celery_app


@celery_app.task(name="settings.purge_orphan_preferences")
def purge_orphan_preferences() -> str:  # pragma: no cover - example
    return "purged"
