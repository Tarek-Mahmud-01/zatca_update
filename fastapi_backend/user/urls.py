"""App URL routing (Django-style URLConf). Paths → view handlers, with RBAC
declared per-route via dependencies. The project root mounts only this `router`.
"""
from fastapi import APIRouter, Depends

from user import views
from user.constants import Role
from core.permissions import require_roles

router = APIRouter(prefix="/users", tags=["users"])

admin_only = [Depends(require_roles(Role.ADMIN))]

# Public auth endpoints.
router.add_api_route("/register", views.register, methods=["POST"], status_code=201)
router.add_api_route("/login", views.login, methods=["POST"])
router.add_api_route("/refresh", views.refresh, methods=["POST"])

# Authenticated.
router.add_api_route("/me", views.me, methods=["GET"])

# Admin-only management (RBAC enforced at the URL layer).
router.add_api_route("", views.list_users, methods=["GET"], dependencies=admin_only)
router.add_api_route("/{user_id}", views.get_user, methods=["GET"], dependencies=admin_only)
router.add_api_route("/{user_id}", views.update_user, methods=["PATCH"], dependencies=admin_only)
router.add_api_route("/{user_id}", views.delete_user, methods=["DELETE"], dependencies=admin_only)
