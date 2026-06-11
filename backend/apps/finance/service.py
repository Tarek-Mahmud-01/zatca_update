from collections.abc import Sequence
from datetime import date
from decimal import Decimal
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.service import BaseService
from apps.finance.constants import DEFAULT_RATE_SORT
from apps.finance.exceptions import CurrencyExists
from apps.finance.models import Currency, ExchangeRate
from apps.finance.repository import CurrencyRepository, ExchangeRateRepository
from apps.finance.schemas import CurrencyCreate, ExchangeRateCreate
from apps.finance.validators import validate_currency_code

_SORT_COLUMNS = {"as_of_date": ExchangeRate.as_of_date, "rate": ExchangeRate.rate}


class FinanceService(BaseService):
    def __init__(self, db: AsyncSession) -> None:
        super().__init__(db)
        self.currencies = CurrencyRepository(db)
        self.rates = ExchangeRateRepository(db)

    async def list_currencies(self) -> Sequence[Currency]:
        return await self.currencies.list(order_by=[Currency.code.asc()])

    async def create_currency(self, payload: CurrencyCreate) -> Currency:
        code = validate_currency_code(payload.code)
        if await self.currencies.exists(Currency.code == code):
            raise CurrencyExists()
        if payload.is_default:
            await self.currencies.clear_default()
        currency = await self.currencies.create(code=code, name=payload.name, is_default=payload.is_default)
        await self.commit()
        return currency

    async def set_default_currency(self, currency_id: UUID) -> Currency:
        currency = await self.currencies.get_or_404(currency_id)
        await self.currencies.clear_default()
        await self.currencies.update(currency, is_default=True)
        await self.commit()
        return currency

    async def list_rates(self, limit: int = 50, offset: int = 0, *, currency_id: UUID | None = None, sort: str | None = None) -> tuple[Sequence[ExchangeRate], int]:
        where = [ExchangeRate.currency_id == currency_id] if currency_id else []
        sort = sort if sort and sort.lstrip("-") in _SORT_COLUMNS else DEFAULT_RATE_SORT
        col = _SORT_COLUMNS[sort.lstrip("-")]
        order_by = [col.desc() if sort.startswith("-") else col.asc()]
        rows = await self.rates.list_rates(*where, order_by=order_by, limit=limit, offset=offset)
        total = await self.rates.count(*where)
        return rows, total

    async def create_rate(self, payload: ExchangeRateCreate) -> ExchangeRate:
        await self.currencies.get_or_404(payload.currency_id)
        as_of = payload.as_of_date or date.today()
        # Upsert: update rate if a row already exists for this currency+date
        existing = await self.rates.find_one(
            ExchangeRate.currency_id == payload.currency_id,
            ExchangeRate.as_of_date == as_of,
        )
        if existing:
            await self.rates.update(existing, rate=payload.rate)
        else:
            await self.rates.create(currency_id=payload.currency_id, rate=payload.rate, as_of_date=as_of)
        await self.commit()
        rows = await self.rates.list_rates(ExchangeRate.currency_id == payload.currency_id, order_by=[ExchangeRate.as_of_date.desc()], limit=1, offset=0)
        return rows[0]
