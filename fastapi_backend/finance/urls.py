"""Finance URLConf. Reads are authenticated; writes are admin-only (RBAC at the
URL layer). The project root mounts only this `router`.
"""
from fastapi import APIRouter, Depends

from core.deps import get_current_user
from core.permissions import require_roles
from finance import views
from user.constants import Role

router = APIRouter(
    prefix="/finance", tags=["finance"], dependencies=[Depends(get_current_user)]
)
admin_only = [Depends(require_roles(Role.ADMIN))]

router.add_api_route("/currencies", views.list_currencies, methods=["GET"])
router.add_api_route("/currencies", views.create_currency, methods=["POST"], status_code=201, dependencies=admin_only)
router.add_api_route("/currencies/{currency_id}/default", views.set_default_currency, methods=["POST"], dependencies=admin_only)

router.add_api_route("/exchange-rates", views.list_rates, methods=["GET"])
router.add_api_route("/exchange-rates", views.create_rate, methods=["POST"], status_code=201, dependencies=admin_only)
