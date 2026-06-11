from fastapi import APIRouter, Depends

from app.deps import current_user
from apps.finance import views

router = APIRouter(prefix="/finance", tags=["finance"], dependencies=[Depends(current_user)])

router.add_api_route("/currencies", views.list_currencies, methods=["GET"])
router.add_api_route("/currencies", views.create_currency, methods=["POST"], status_code=201)
router.add_api_route("/currencies/{currency_id}/default", views.set_default_currency, methods=["POST"])
router.add_api_route("/exchange-rates", views.list_rates, methods=["GET"])
router.add_api_route("/exchange-rates", views.create_rate, methods=["POST"], status_code=201)
