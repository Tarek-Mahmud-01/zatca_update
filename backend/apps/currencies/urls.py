from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps import CurrentUserDep
from apps.currencies.models import TenantCurrency
from apps.currencies.schemas import CurrencyCreate, CurrencyRead, CurrencyUpdate

router = APIRouter(prefix="/currencies", tags=["currencies"])


@router.get("", response_model=list[CurrencyRead])
async def list_currencies(
    user: CurrentUserDep,
    db: AsyncSession = Depends(get_db),
) -> list[TenantCurrency]:
    result = await db.execute(
        select(TenantCurrency).where(TenantCurrency.tenant_id == user.tenant_id)
    )
    return result.scalars().all()


@router.post("", response_model=CurrencyRead, status_code=status.HTTP_201_CREATED)
async def create_currency(
    body: CurrencyCreate,
    user: CurrentUserDep,
    db: AsyncSession = Depends(get_db),
) -> TenantCurrency:
    if body.is_default:
        await db.execute(
            update(TenantCurrency)
            .where(TenantCurrency.tenant_id == user.tenant_id)
            .values(is_default=False)
        )

    currency = TenantCurrency(
        tenant_id=user.tenant_id,
        code=body.code.upper(),
        exchange_rate=body.exchange_rate,
        as_of_date=body.as_of_date,
        is_default=body.is_default,
    )
    db.add(currency)
    await db.commit()
    await db.refresh(currency)
    return currency


@router.get("/{currency_id}", response_model=CurrencyRead)
async def get_currency(
    currency_id: UUID,
    user: CurrentUserDep,
    db: AsyncSession = Depends(get_db),
) -> TenantCurrency:
    currency = await db.get(TenantCurrency, currency_id)
    if not currency or currency.tenant_id != user.tenant_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="currency_not_found")
    return currency


@router.patch("/{currency_id}", response_model=CurrencyRead)
async def update_currency(
    currency_id: UUID,
    body: CurrencyUpdate,
    user: CurrentUserDep,
    db: AsyncSession = Depends(get_db),
) -> TenantCurrency:
    currency = await db.get(TenantCurrency, currency_id)
    if not currency or currency.tenant_id != user.tenant_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="currency_not_found")

    if body.is_default is True:
        await db.execute(
            update(TenantCurrency)
            .where(
                TenantCurrency.tenant_id == user.tenant_id,
                TenantCurrency.id != currency_id,
            )
            .values(is_default=False)
        )

    patch_data = body.model_dump(exclude_unset=True)
    for field, value in patch_data.items():
        setattr(currency, field, value)

    await db.commit()
    await db.refresh(currency)
    return currency


@router.delete("/{currency_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_currency(
    currency_id: UUID,
    user: CurrentUserDep,
    db: AsyncSession = Depends(get_db),
) -> None:
    currency = await db.get(TenantCurrency, currency_id)
    if not currency or currency.tenant_id != user.tenant_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="currency_not_found")
    await db.delete(currency)
    await db.commit()
