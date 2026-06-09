"""User repository — all User ORM access lives here."""
from user.models import User
from core.repository import BaseRepository


class UserRepository(BaseRepository[User]):
    model = User

    async def get_by_email(self, email: str) -> User | None:
        return await self.find_one(User.email == email)

    async def email_exists(self, email: str) -> bool:
        return await self.exists(User.email == email)
