"""Celery application. Run a worker with:

    celery -A core.celery_app.celery_app worker -l info
"""
from celery import Celery

from core.config import get_settings

_settings = get_settings()

celery_app = Celery(
    "app",
    broker=_settings.celery_broker_url,
    backend=_settings.redis_url,
)
celery_app.conf.update(
    task_track_started=True,
    task_time_limit=300,
    task_acks_late=True,
    worker_max_tasks_per_child=200,
)

# Each app exposes a tasks.py; autodiscovery imports them.
celery_app.autodiscover_tasks(["user", "invoice", "finance", "settings", "account"])
