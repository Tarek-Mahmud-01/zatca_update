"""Settings URLConf — authenticated, per-user preferences."""
from fastapi import APIRouter, Depends

from core.deps import get_current_user
from settings import views

router = APIRouter(
    prefix="/settings", tags=["settings"], dependencies=[Depends(get_current_user)]
)

router.add_api_route("/preferences", views.list_preferences, methods=["GET"])
router.add_api_route("/preferences/{key}", views.upsert_preference, methods=["PUT"])
router.add_api_route("/preferences/{key}", views.delete_preference, methods=["DELETE"])
