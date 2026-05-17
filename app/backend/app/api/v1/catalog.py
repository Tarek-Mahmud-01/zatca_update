"""CRUD endpoints for product categories, products, and customers."""
from __future__ import annotations

from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import asc, select

from app.db.models import Category, Customer, Product
from app.deps import CurrentUserDep, DbSession

router = APIRouter(tags=["catalog"])


# ---------------------------------------------------------------------------
# Categories
# ---------------------------------------------------------------------------


class CategoryIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = None


class CategoryOut(BaseModel):
    id: UUID
    name: str
    description: str | None


@router.get("/categories", response_model=list[CategoryOut])
async def list_categories(user: CurrentUserDep, db: DbSession) -> list[CategoryOut]:
    rows = (
        await db.execute(
            select(Category).where(Category.tenant_id == user.tenant_id).order_by(asc(Category.name))
        )
    ).scalars().all()
    return [CategoryOut(id=r.id, name=r.name, description=r.description) for r in rows]


@router.post("/categories", response_model=CategoryOut, status_code=status.HTTP_201_CREATED)
async def create_category(body: CategoryIn, user: CurrentUserDep, db: DbSession) -> CategoryOut:
    existing = await db.scalar(
        select(Category).where(Category.tenant_id == user.tenant_id, Category.name == body.name)
    )
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, "name_taken")
    row = Category(tenant_id=user.tenant_id, name=body.name, description=body.description)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return CategoryOut(id=row.id, name=row.name, description=row.description)


@router.patch("/categories/{cat_id}", response_model=CategoryOut)
async def update_category(
    cat_id: UUID, body: CategoryIn, user: CurrentUserDep, db: DbSession
) -> CategoryOut:
    row = await db.scalar(
        select(Category).where(Category.id == cat_id, Category.tenant_id == user.tenant_id)
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "not_found")
    row.name = body.name
    row.description = body.description
    await db.commit()
    await db.refresh(row)
    return CategoryOut(id=row.id, name=row.name, description=row.description)


@router.delete("/categories/{cat_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_category(cat_id: UUID, user: CurrentUserDep, db: DbSession) -> None:
    row = await db.scalar(
        select(Category).where(Category.id == cat_id, Category.tenant_id == user.tenant_id)
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "not_found")
    await db.delete(row)
    await db.commit()


# ---------------------------------------------------------------------------
# Products
# ---------------------------------------------------------------------------


class ProductIn(BaseModel):
    sku: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=200)
    description: str | None = None
    category_id: UUID | None = None
    unit_price: Decimal = Decimal("0.00")
    unit_code: str = Field(default="PCE", max_length=8)
    tax_category: str = Field(default="S", pattern="^[SZEOG]$")
    tax_percent: Decimal = Decimal("15")


class ProductOut(BaseModel):
    id: UUID
    sku: str
    name: str
    description: str | None
    category_id: UUID | None
    category_name: str | None
    unit_price: Decimal
    unit_code: str
    tax_category: str
    tax_percent: Decimal


@router.get("/products", response_model=list[ProductOut])
async def list_products(
    user: CurrentUserDep,
    db: DbSession,
    q: str | None = Query(default=None, description="search in sku/name"),
    category_id: UUID | None = None,
) -> list[ProductOut]:
    stmt = (
        select(Product, Category.name)
        .outerjoin(Category, Product.category_id == Category.id)
        .where(Product.tenant_id == user.tenant_id)
        .order_by(asc(Product.name))
    )
    if q:
        like = f"%{q.lower()}%"
        from sqlalchemy import func, or_
        stmt = stmt.where(or_(func.lower(Product.sku).like(like), func.lower(Product.name).like(like)))
    if category_id is not None:
        stmt = stmt.where(Product.category_id == category_id)
    rows = (await db.execute(stmt)).all()
    return [
        ProductOut(
            id=p.id, sku=p.sku, name=p.name, description=p.description,
            category_id=p.category_id, category_name=cat_name,
            unit_price=p.unit_price, unit_code=p.unit_code,
            tax_category=p.tax_category, tax_percent=p.tax_percent,
        )
        for p, cat_name in rows
    ]


async def _resolve_product(db, tenant_id: UUID, product_id: UUID) -> Product:
    row = await db.scalar(
        select(Product).where(Product.id == product_id, Product.tenant_id == tenant_id)
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "not_found")
    return row


@router.get("/products/{product_id}", response_model=ProductOut)
async def get_product(product_id: UUID, user: CurrentUserDep, db: DbSession) -> ProductOut:
    p = await _resolve_product(db, user.tenant_id, product_id)
    cat_name = None
    if p.category_id is not None:
        cat_name = await db.scalar(select(Category.name).where(Category.id == p.category_id))
    return ProductOut(
        id=p.id, sku=p.sku, name=p.name, description=p.description,
        category_id=p.category_id, category_name=cat_name,
        unit_price=p.unit_price, unit_code=p.unit_code,
        tax_category=p.tax_category, tax_percent=p.tax_percent,
    )


@router.post("/products", response_model=ProductOut, status_code=status.HTTP_201_CREATED)
async def create_product(body: ProductIn, user: CurrentUserDep, db: DbSession) -> ProductOut:
    if await db.scalar(
        select(Product).where(Product.tenant_id == user.tenant_id, Product.sku == body.sku)
    ):
        raise HTTPException(status.HTTP_409_CONFLICT, "sku_taken")
    p = Product(
        tenant_id=user.tenant_id, sku=body.sku, name=body.name, description=body.description,
        category_id=body.category_id, unit_price=body.unit_price, unit_code=body.unit_code,
        tax_category=body.tax_category, tax_percent=body.tax_percent,
    )
    db.add(p)
    await db.commit()
    await db.refresh(p)
    return await get_product(p.id, user, db)  # reuse the join lookup for category_name


@router.patch("/products/{product_id}", response_model=ProductOut)
async def update_product(
    product_id: UUID, body: ProductIn, user: CurrentUserDep, db: DbSession
) -> ProductOut:
    p = await _resolve_product(db, user.tenant_id, product_id)
    p.sku = body.sku
    p.name = body.name
    p.description = body.description
    p.category_id = body.category_id
    p.unit_price = body.unit_price
    p.unit_code = body.unit_code
    p.tax_category = body.tax_category
    p.tax_percent = body.tax_percent
    await db.commit()
    return await get_product(p.id, user, db)


@router.delete("/products/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_product(product_id: UUID, user: CurrentUserDep, db: DbSession) -> None:
    p = await _resolve_product(db, user.tenant_id, product_id)
    await db.delete(p)
    await db.commit()


# ---------------------------------------------------------------------------
# Customers
# ---------------------------------------------------------------------------


class CustomerIn(BaseModel):
    external_id: str | None = None
    name: str = Field(min_length=1, max_length=200)
    vat_number: str | None = Field(default=None, max_length=15)
    crn: str | None = None
    email: EmailStr | None = None
    phone: str | None = None
    street: str = ""
    building_number: str = ""
    city_subdivision: str = ""
    city: str = ""
    postal_zone: str = ""
    country_code: str = Field(default="SA", min_length=2, max_length=2)


class CustomerOut(CustomerIn):
    id: UUID


@router.get("/customers", response_model=list[CustomerOut])
async def list_customers(
    user: CurrentUserDep,
    db: DbSession,
    q: str | None = Query(default=None),
) -> list[CustomerOut]:
    stmt = select(Customer).where(Customer.tenant_id == user.tenant_id).order_by(asc(Customer.name))
    if q:
        from sqlalchemy import func, or_
        like = f"%{q.lower()}%"
        stmt = stmt.where(or_(
            func.lower(Customer.name).like(like),
            func.lower(Customer.vat_number).like(like),
        ))
    rows = (await db.execute(stmt)).scalars().all()
    return [CustomerOut(**_customer_dict(r)) for r in rows]


def _customer_dict(c: Customer) -> dict:
    return {
        "id": c.id, "external_id": c.external_id, "name": c.name,
        "vat_number": c.vat_number, "crn": c.crn, "email": c.email, "phone": c.phone,
        "street": c.street, "building_number": c.building_number,
        "city_subdivision": c.city_subdivision, "city": c.city,
        "postal_zone": c.postal_zone, "country_code": c.country_code,
    }


async def _resolve_customer(db, tenant_id: UUID, customer_id: UUID) -> Customer:
    row = await db.scalar(
        select(Customer).where(Customer.id == customer_id, Customer.tenant_id == tenant_id)
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "not_found")
    return row


@router.get("/customers/{customer_id}", response_model=CustomerOut)
async def get_customer(customer_id: UUID, user: CurrentUserDep, db: DbSession) -> CustomerOut:
    c = await _resolve_customer(db, user.tenant_id, customer_id)
    return CustomerOut(**_customer_dict(c))


@router.post("/customers", response_model=CustomerOut, status_code=status.HTTP_201_CREATED)
async def create_customer(body: CustomerIn, user: CurrentUserDep, db: DbSession) -> CustomerOut:
    c = Customer(tenant_id=user.tenant_id, **body.model_dump())
    db.add(c)
    await db.commit()
    await db.refresh(c)
    return CustomerOut(**_customer_dict(c))


@router.patch("/customers/{customer_id}", response_model=CustomerOut)
async def update_customer(
    customer_id: UUID, body: CustomerIn, user: CurrentUserDep, db: DbSession
) -> CustomerOut:
    c = await _resolve_customer(db, user.tenant_id, customer_id)
    for field, value in body.model_dump().items():
        setattr(c, field, value)
    await db.commit()
    await db.refresh(c)
    return CustomerOut(**_customer_dict(c))


@router.delete("/customers/{customer_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_customer(customer_id: UUID, user: CurrentUserDep, db: DbSession) -> None:
    c = await _resolve_customer(db, user.tenant_id, customer_id)
    await db.delete(c)
    await db.commit()
