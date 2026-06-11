from fastapi import APIRouter, Depends

from app.deps import current_user
from apps.account import views

router = APIRouter(prefix="/account", tags=["account"], dependencies=[Depends(current_user)])

router.add_api_route("/me", views.get_profile, methods=["GET"])
router.add_api_route("/profile", views.update_profile, methods=["PATCH"])
router.add_api_route("/change-password", views.change_password, methods=["POST"])
