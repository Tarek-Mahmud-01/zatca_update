"""Finance view handlers — thin."""
from uuid import UUID

from fastapi import Depends, Query

from core.deps import DbSession
from core.pagination import PageParams, pagination_params, paginate
from core.responses import success
from finance.schemas import (
    CurrencyCreate,
    CurrencyRead,
    ExchangeRateCreate,
    ExchangeRateRead,
)
from finance.service import FinanceService


async def list_currencies(db: DbSession) -> dict:
    rows = await FinanceService(db).list_currencies()
    return success([CurrencyRead.model_validate(r).model_dump(mode="json") for r in rows])


async def create_currency(payload: CurrencyCreate, db: DbSession) -> dict:
    currency = await FinanceService(db).create_currency(payload)
    return success(CurrencyRead.model_validate(currency).model_dump(mode="json"), message="Created.")


async def set_default_currency(currency_id: UUID, db: DbSession) -> dict:
    currency = await FinanceService(db).set_default_currency(currency_id)
    return success(CurrencyRead.model_validate(currency).model_dump(mode="json"), message="Default set.")


async def list_rates(
    db: DbSession,
    params: PageParams = Depends(pagination_params),
    currency_id: UUID | None = Query(default=None),
    sort: str | None = Query(default=None, description="as_of_date|rate, prefix - for desc"),
) -> dict:
    rows, total = await FinanceService(db).list_rates(params, currency_id=currency_id, sort=sort)
    data = [ExchangeRateRead.model_validate(r).model_dump(mode="json") for r in rows]
    return paginate(data, total, params)


async def create_rate(payload: ExchangeRateCreate, db: DbSession) -> dict:
    rate = await FinanceService(db).create_rate(payload)
    return success(ExchangeRateRead.model_validate(rate).model_dump(mode="json"), message="Created.")
