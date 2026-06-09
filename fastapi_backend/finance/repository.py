"""Finance repositories — the only ORM access for currencies + exchange rates."""
from collections.abc import Sequence
from typing import Any

from sqlalchemy import update as sa_update
from sqlalchemy.orm import joinedload
from sqlalchemy.sql.base import ExecutableOption

from core.repository import BaseRepository
from finance.models import Currency, ExchangeRate


class CurrencyRepository(BaseRepository[Currency]):
    model = Currency

    async def get_by_code(self, code: str) -> Currency | None:
        return await self.find_one(Currency.code == code)

    async def clear_default(self) -> int:
        """Single UPDATE to unset the current default before setting a new one."""
        stmt = sa_update(Currency).where(Currency.is_default.is_(True)).values(is_default=False)
        result = await self.db.execute(stmt)
        return int(result.rowcount or 0)


class ExchangeRateRepository(BaseRepository[ExchangeRate]):
    model = ExchangeRate

    @staticmethod
    def _options() -> tuple[ExecutableOption, ...]:
        # JOIN the currency (to-one) — one query, no N+1 when serializing.
        return (joinedload(ExchangeRate.currency),)

    async def list_rates(
        self, *whereclause: Any, order_by: Sequence[Any], limit: int, offset: int
    ) -> Sequence[ExchangeRate]:
        return await self.list(
            *whereclause, order_by=order_by, options=self._options(), limit=limit, offset=offset
        )
