from uuid import UUID

from fastapi import Query

from app.deps import DbSession
from apps.finance.schemas import CurrencyCreate, CurrencyRead, ExchangeRateCreate, ExchangeRateRead
from apps.finance.service import FinanceService


async def list_currencies(db: DbSession) -> list:
    rows = await FinanceService(db).list_currencies()
    return [CurrencyRead.model_validate(r).model_dump(mode="json") for r in rows]


async def create_currency(payload: CurrencyCreate, db: DbSession) -> dict:
    currency = await FinanceService(db).create_currency(payload)
    return CurrencyRead.model_validate(currency).model_dump(mode="json")


async def set_default_currency(currency_id: UUID, db: DbSession) -> dict:
    currency = await FinanceService(db).set_default_currency(currency_id)
    return CurrencyRead.model_validate(currency).model_dump(mode="json")


async def list_rates(
    db: DbSession,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    currency_id: UUID | None = Query(default=None),
    sort: str | None = Query(default=None),
) -> dict:
    rows, total = await FinanceService(db).list_rates(limit, offset, currency_id=currency_id, sort=sort)
    return {"items": [ExchangeRateRead.model_validate(r).model_dump(mode="json") for r in rows], "total": total}


async def create_rate(payload: ExchangeRateCreate, db: DbSession) -> dict:
    rate = await FinanceService(db).create_rate(payload)
    return ExchangeRateRead.model_validate(rate).model_dump(mode="json")
