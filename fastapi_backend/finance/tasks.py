"""Finance background tasks (Celery) — e.g. nightly rate refresh."""
from core.celery_app import celery_app


@celery_app.task(name="finance.refresh_rates")
def refresh_rates() -> str:  # pragma: no cover - example
    # Fetch upstream FX rates and bulk-insert. Opens its own session.
    return "rates_refreshed"
