from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import or_, select

from app.deps import CurrentUserDep, DbSession
from apps.products.models import Product
from apps.products.schemas import ProductCreate, ProductRead, ProductUpdate

router = APIRouter(prefix="/products", tags=["products"])


@router.get("", response_model=list[ProductRead])
async def list_products(
    user: CurrentUserDep,
    db: DbSession,
    q: str | None = Query(default=None, description="Search on name or SKU"),
    category: UUID | None = Query(default=None, description="Filter by category_id"),
):
    stmt = (
        select(Product)
        .where(Product.tenant_id == user.tenant_id)
        .order_by(Product.name)
    )
    if q:
        pattern = f"%{q}%"
        stmt = stmt.where(
            or_(Product.name.ilike(pattern), Product.sku.ilike(pattern))
        )
    if category is not None:
        stmt = stmt.where(Product.category_id == category)

    result = await db.execute(stmt)
    return result.scalars().all()


@router.post("", response_model=ProductRead, status_code=status.HTTP_201_CREATED)
async def create_product(payload: ProductCreate, user: CurrentUserDep, db: DbSession):
    product = Product(tenant_id=user.tenant_id, **payload.model_dump())
    db.add(product)
    await db.commit()
    await db.refresh(product)
    return product


@router.get("/{id}", response_model=ProductRead)
async def get_product(id: UUID, user: CurrentUserDep, db: DbSession):
    result = await db.execute(
        select(Product).where(
            Product.id == id, Product.tenant_id == user.tenant_id
        )
    )
    product = result.scalar_one_or_none()
    if product is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    return product


@router.patch("/{id}", response_model=ProductRead)
async def update_product(
    id: UUID, payload: ProductUpdate, user: CurrentUserDep, db: DbSession
):
    result = await db.execute(
        select(Product).where(
            Product.id == id, Product.tenant_id == user.tenant_id
        )
    )
    product = result.scalar_one_or_none()
    if product is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")

    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(product, field, value)

    await db.commit()
    await db.refresh(product)
    return product


@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_product(id: UUID, user: CurrentUserDep, db: DbSession):
    result = await db.execute(
        select(Product).where(
            Product.id == id, Product.tenant_id == user.tenant_id
        )
    )
    product = result.scalar_one_or_none()
    if product is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")

    await db.delete(product)
    await db.commit()
