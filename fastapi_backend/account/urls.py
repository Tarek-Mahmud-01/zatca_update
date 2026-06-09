"""Account URLConf — authenticated self-service."""
from fastapi import APIRouter, Depends

from account import views
from core.deps import get_current_user

router = APIRouter(
    prefix="/account", tags=["account"], dependencies=[Depends(get_current_user)]
)

router.add_api_route("/me", views.get_profile, methods=["GET"])
router.add_api_route("/profile", views.update_profile, methods=["PATCH"])
router.add_api_route("/change-password", views.change_password, methods=["POST"])
