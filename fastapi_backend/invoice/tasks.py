"""Invoice background tasks (Celery)."""
from core.celery_app import celery_app


@celery_app.task(name="invoices.recompute_totals", bind=True, max_retries=3)
def recompute_totals(self, invoice_id: str) -> str:  # pragma: no cover - example
    # Example heavy/async-offloaded job. Open your own session here; never reuse
    # a request session. Kept idempotent so retries are safe.
    return f"recomputed:{invoice_id}"
