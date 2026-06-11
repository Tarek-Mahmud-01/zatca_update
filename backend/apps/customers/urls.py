from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps import CurrentUserDep
from apps.customers.models import Customer
from apps.customers.schemas import CustomerCreate, CustomerRead, CustomerUpdate

router = APIRouter(prefix="/customers", tags=["customers"])


@router.get("", response_model=list[CustomerRead])
async def list_customers(
    user: CurrentUserDep,
    db: AsyncSession = Depends(get_db),
    q: str | None = None,
) -> list[Customer]:
    stmt = select(Customer).where(Customer.tenant_id == user.tenant_id)
    if q:
        stmt = stmt.where(Customer.name.ilike(f"%{q}%"))
    stmt = stmt.order_by(Customer.name)
    result = await db.execute(stmt)
    return list(result.scalars().all())


@router.post("", response_model=CustomerRead, status_code=status.HTTP_201_CREATED)
async def create_customer(
    body: CustomerCreate,
    user: CurrentUserDep,
    db: AsyncSession = Depends(get_db),
) -> Customer:
    customer = Customer(tenant_id=user.tenant_id, **body.model_dump())
    db.add(customer)
    await db.commit()
    await db.refresh(customer)
    return customer


@router.get("/{id}", response_model=CustomerRead)
async def get_customer(
    id: UUID,
    user: CurrentUserDep,
    db: AsyncSession = Depends(get_db),
) -> Customer:
    customer = await db.get(Customer, id)
    if not customer or customer.tenant_id != user.tenant_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="customer_not_found")
    return customer


@router.patch("/{id}", response_model=CustomerRead)
async def update_customer(
    id: UUID,
    body: CustomerUpdate,
    user: CurrentUserDep,
    db: AsyncSession = Depends(get_db),
) -> Customer:
    customer = await db.get(Customer, id)
    if not customer or customer.tenant_id != user.tenant_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="customer_not_found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(customer, field, value)
    await db.commit()
    await db.refresh(customer)
    return customer


@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_customer(
    id: UUID,
    user: CurrentUserDep,
    db: AsyncSession = Depends(get_db),
) -> Response:
    customer = await db.get(Customer, id)
    if not customer or customer.tenant_id != user.tenant_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="customer_not_found")
    await db.delete(customer)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
