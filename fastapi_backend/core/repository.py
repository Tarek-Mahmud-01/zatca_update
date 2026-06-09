"""Generic async repository.

The ONLY layer that touches the ORM. Services depend on repositories, never on
the session directly. Loader `options` (joinedload / selectinload) are passed in
by the service so relationships are eager-loaded in ONE round-trip — this is how
we structurally prevent N+1 (no lazy access in serializers, no queries in loops).
"""
from collections.abc import Sequence
from typing import Any, Generic, TypeVar

from sqlalchemy import delete as sa_delete
from sqlalchemy import func, select, update as sa_update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import Select
from sqlalchemy.sql.base import ExecutableOption

from core.database import Base
from core.exceptions import NotFoundError

ModelT = TypeVar("ModelT", bound=Base)


class BaseRepository(Generic[ModelT]):
    model: type[ModelT]

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    # -- read ----------------------------------------------------------------
    def select(self) -> Select[tuple[ModelT]]:
        return select(self.model)

    async def get(
        self, pk: Any, *, options: Sequence[ExecutableOption] | None = None
    ) -> ModelT | None:
        stmt = self.select().where(self.model.id == pk)  # type: ignore[attr-defined]
        if options:
            stmt = stmt.options(*options)
        return (await self.db.execute(stmt)).scalar_one_or_none()

    async def get_or_404(
        self, pk: Any, *, options: Sequence[ExecutableOption] | None = None
    ) -> ModelT:
        obj = await self.get(pk, options=options)
        if obj is None:
            raise NotFoundError(f"{self.model.__name__} '{pk}' not found.")
        return obj

    async def find_one(
        self, *whereclause: Any, options: Sequence[ExecutableOption] | None = None
    ) -> ModelT | None:
        stmt = self.select().where(*whereclause)
        if options:
            stmt = stmt.options(*options)
        return (await self.db.execute(stmt)).scalar_one_or_none()

    async def list(
        self,
        *whereclause: Any,
        order_by: Sequence[Any] | None = None,
        options: Sequence[ExecutableOption] | None = None,
        limit: int | None = None,
        offset: int | None = None,
    ) -> Sequence[ModelT]:
        stmt = self.select()
        if whereclause:
            stmt = stmt.where(*whereclause)
        if options:
            stmt = stmt.options(*options)
        if order_by:
            stmt = stmt.order_by(*order_by)
        if offset is not None:
            stmt = stmt.offset(offset)
        if limit is not None:
            stmt = stmt.limit(limit)
        # .unique() is required when a joinedload on a collection is present.
        return (await self.db.execute(stmt)).unique().scalars().all()

    async def count(self, *whereclause: Any) -> int:
        stmt = select(func.count()).select_from(self.model)
        if whereclause:
            stmt = stmt.where(*whereclause)
        return int((await self.db.execute(stmt)).scalar_one())

    async def exists(self, *whereclause: Any) -> bool:
        stmt = select(self.model.id).where(*whereclause).limit(1)  # type: ignore[attr-defined]
        return (await self.db.execute(stmt)).first() is not None

    # -- write (no commit — the service owns the transaction) ----------------
    def add(self, instance: ModelT) -> ModelT:
        self.db.add(instance)
        return instance

    async def create(self, **data: Any) -> ModelT:
        obj = self.model(**data)
        self.db.add(obj)
        await self.db.flush()
        return obj

    async def bulk_create(self, rows: Sequence[dict[str, Any]]) -> list[ModelT]:
        objs = [self.model(**row) for row in rows]
        self.db.add_all(objs)
        await self.db.flush()
        return objs

    async def update(self, instance: ModelT, **data: Any) -> ModelT:
        for key, value in data.items():
            setattr(instance, key, value)
        await self.db.flush()
        return instance

    async def bulk_update_by_ids(self, ids: Sequence[Any], **data: Any) -> int:
        """Single UPDATE … WHERE id IN (…) — never a loop of saves."""
        stmt = sa_update(self.model).where(self.model.id.in_(ids)).values(**data)  # type: ignore[attr-defined]
        result = await self.db.execute(stmt)
        return int(result.rowcount or 0)

    async def delete(self, instance: ModelT) -> None:
        await self.db.delete(instance)
        await self.db.flush()

    async def delete_by_id(self, pk: Any) -> int:
        stmt = sa_delete(self.model).where(self.model.id == pk)  # type: ignore[attr-defined]
        result = await self.db.execute(stmt)
        return int(result.rowcount or 0)
