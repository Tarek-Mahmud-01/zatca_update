"""Background tasks for the users app (Celery). Imported by Celery autodiscovery.

Tasks are thin: they re-open their own resources and delegate to services — never
import a request-scoped session.
"""
from core.celery_app import celery_app


@celery_app.task(name="users.send_welcome_email")
def send_welcome_email(user_id: str) -> str:
    # Placeholder — wire to your email provider. Kept side-effect-only and
    # idempotent so retries are safe.
    return f"welcome_email_sent:{user_id}"
