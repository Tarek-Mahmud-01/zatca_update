from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.exceptions import AuthenticationError, ConflictError
from app.security import create_access_token, hash_password, verify_password
from apps.auth.models import Tenant, TenantUser
from apps.events.broadcaster import publish


class AuthService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def login(self, email: str, password: str, remember_me: bool = False) -> dict:
        result = await self.db.execute(select(TenantUser).where(TenantUser.email == email))
        user = result.scalar_one_or_none()
        if not user or not verify_password(password, user.hashed_password):
            raise AuthenticationError("invalid_credentials")
        # ── TEST MODE ── 300 s token so force-logout via WebSocket can be tested.
        # Remove this line and restore the production values below when done testing.
        expires_minutes = 0.5  # 30 seconds
        # expires_minutes = 5_256_000 if remember_me else 480  # production values
        token = create_access_token(user.id, user.tenant_id, user.role, expires_minutes=expires_minutes)

        # Single-session enforcement: kick any existing WebSocket session for
        # this user so only the newest login remains connected.
        await publish(str(user.tenant_id), {"type": "force_logout", "user_id": str(user.id)})

        return {
            "access_token": token,
            "token_type": "bearer",
            "role": user.role,
            "tenant_id": user.tenant_id,
            "expires_in": expires_minutes * 60,
        }

    async def signup(
        self,
        tenant_name: str,
        vat_number: str,
        organization_identifier: str,
        email: str,
        password: str,
    ) -> dict:
        existing = await self.db.execute(select(Tenant).where(Tenant.vat_number == vat_number))
        if existing.scalar_one_or_none():
            raise ConflictError("tenant_with_this_vat_already_exists")

        tenant = Tenant(
            name=tenant_name,
            vat_number=vat_number,
            organization_identifier=organization_identifier,
        )
        self.db.add(tenant)
        await self.db.flush()

        user = TenantUser(
            tenant_id=tenant.id,
            email=email,
            hashed_password=hash_password(password),
            role="admin",
        )
        self.db.add(user)
        await self.db.commit()
        await self.db.refresh(user)

        token = create_access_token(user.id, tenant.id, user.role)
        return {
            "access_token": token,
            "token_type": "bearer",
            "role": user.role,
            "tenant_id": tenant.id,
        }
