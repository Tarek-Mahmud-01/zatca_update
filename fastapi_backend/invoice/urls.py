"""Invoice URLConf. All routes require authentication (current-user dependency
inside the views); ownership/RBAC is enforced in the views/service layer.
The project root mounts only this `router`.
"""
from fastapi import APIRouter

from invoice import views

router = APIRouter(prefix="/invoices", tags=["invoices"])

router.add_api_route("", views.create_invoice, methods=["POST"], status_code=201)
router.add_api_route("", views.list_invoices, methods=["GET"])
router.add_api_route("/stats", views.invoice_stats, methods=["GET"])
router.add_api_route("/{invoice_id}", views.get_invoice, methods=["GET"])
router.add_api_route("/{invoice_id}/status", views.update_invoice_status, methods=["PATCH"])
