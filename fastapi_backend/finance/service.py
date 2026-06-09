"""Finance business logic."""
from collections.abc import Sequence
from datetime import date
from decimal import Decimal
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from core.pagination import PageParams
from core.service import BaseService
from finance.constants import DEFAULT_RATE_SORT
from finance.exceptions import CurrencyExists
from finance.models import Currency, ExchangeRate
from finance.repository import CurrencyRepository, ExchangeRateRepository
from finance.schemas import CurrencyCreate, ExchangeRateCreate
from finance.validators import validate_currency_code

_SORT_COLUMNS = {"as_of_date": ExchangeRate.as_of_date, "rate": ExchangeRate.rate}


class FinanceService(BaseService):
    def __init__(self, db: AsyncSession) -> None:
        super().__init__(db)
        self.currencies = CurrencyRepository(db)
        self.rates = ExchangeRateRepository(db)

    # -- currencies ----------------------------------------------------------
    async def list_currencies(self) -> Sequence[Currency]:
        return await self.currencies.list(order_by=[Currency.code.asc()])

    async def create_currency(self, payload: CurrencyCreate) -> Currency:
        code = validate_currency_code(payload.code)
        if await self.currencies.exists(Currency.code == code):
            raise CurrencyExists()
        if payload.is_default:
            await self.currencies.clear_default()  # single UPDATE, no loop
        currency = await self.currencies.create(
            code=code, name=payload.name, is_default=payload.is_default
        )
        await self.commit()
        return currency

    async def set_default_currency(self, currency_id: UUID) -> Currency:
        currency = await self.currencies.get_or_404(currency_id)
        await self.currencies.clear_default()
        await self.currencies.update(currency, is_default=True)
        await self.commit()
        return currency

    # -- exchange rates ------------------------------------------------------
    async def list_rates(
        self, params: PageParams, *, currency_id: UUID | None = None, sort: str | None = None
    ) -> tuple[Sequence[ExchangeRate], int]:
        where = [ExchangeRate.currency_id == currency_id] if currency_id else []
        sort = sort if sort and sort.lstrip("-") in _SORT_COLUMNS else DEFAULT_RATE_SORT
        col = _SORT_COLUMNS[sort.lstrip("-")]
        order_by = [col.desc() if sort.startswith("-") else col.asc()]
        rows = await self.rates.list_rates(
            *where, order_by=order_by, limit=params.limit, offset=params.offset
        )
        total = await self.rates.count(*where)
        return rows, total

    async def create_rate(self, payload: ExchangeRateCreate) -> ExchangeRate:
        await self.currencies.get_or_404(payload.currency_id)
        await self.rates.create(
            currency_id=payload.currency_id, rate=payload.rate, as_of_date=payload.as_of_date
        )
        await self.commit()
        # Re-fetch eager-loaded (currency joined) for the response.
        rows = await self.rates.list_rates(
            ExchangeRate.currency_id == payload.currency_id,
            order_by=[ExchangeRate.as_of_date.desc()],
            limit=1,
            offset=0,
        )
        return rows[0]

    async def bulk_import_rates(self, currency_id: UUID, rows: list[tuple[Decimal, date]]) -> int:
        """Bulk INSERT many daily rates in one round-trip."""
        await self.currencies.get_or_404(currency_id)
        payload = [{"currency_id": currency_id, "rate": r, "as_of_date": d} for r, d in rows]
        created = await self.rates.bulk_create(payload)
        await self.commit()
        return len(created)
