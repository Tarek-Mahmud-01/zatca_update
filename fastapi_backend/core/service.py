"""Base service. Business logic lives here — never in views or schemas.

A service owns the unit of work: it calls repositories, enforces invariants, and
commits. Views call exactly one service method and wrap the result in the
response envelope.
"""
from sqlalchemy.ext.asyncio import AsyncSession


class BaseService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def commit(self) -> None:
        await self.db.commit()
