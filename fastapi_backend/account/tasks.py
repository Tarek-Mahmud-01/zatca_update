"""Account background tasks (Celery)."""
from core.celery_app import celery_app


@celery_app.task(name="account.notify_password_changed")
def notify_password_changed(user_id: str) -> str:  # pragma: no cover - example
    return f"password_change_notified:{user_id}"
