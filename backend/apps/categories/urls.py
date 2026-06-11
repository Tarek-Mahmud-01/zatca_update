from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.deps import CurrentUserDep, DbSession
from app.exceptions import NotFoundError
from apps.categories.models import Category
from apps.categories.schemas import CategoryCreate, CategoryUpdate, CategoryRead

router = APIRouter(prefix="/categories", tags=["categories"])


@router.get("", response_model=list[CategoryRead])
async def list_categories(user: CurrentUserDep, db: DbSession):
    result = await db.execute(
        select(Category)
        .where(Category.tenant_id == user.tenant_id)
        .order_by(Category.name)
    )
    return result.scalars().all()


@router.post("", response_model=CategoryRead, status_code=status.HTTP_201_CREATED)
async def create_category(
    payload: CategoryCreate, user: CurrentUserDep, db: DbSession
):
    category = Category(
        tenant_id=user.tenant_id,
        name=payload.name,
        description=payload.description,
    )
    db.add(category)
    await db.commit()
    await db.refresh(category)
    return category


@router.get("/{id}", response_model=CategoryRead)
async def get_category(id: UUID, user: CurrentUserDep, db: DbSession):
    result = await db.execute(
        select(Category).where(
            Category.id == id, Category.tenant_id == user.tenant_id
        )
    )
    category = result.scalar_one_or_none()
    if category is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")
    return category


@router.patch("/{id}", response_model=CategoryRead)
async def update_category(
    id: UUID, payload: CategoryUpdate, user: CurrentUserDep, db: DbSession
):
    result = await db.execute(
        select(Category).where(
            Category.id == id, Category.tenant_id == user.tenant_id
        )
    )
    category = result.scalar_one_or_none()
    if category is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")

    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(category, field, value)

    await db.commit()
    await db.refresh(category)
    return category


@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_category(id: UUID, user: CurrentUserDep, db: DbSession):
    result = await db.execute(
        select(Category).where(
            Category.id == id, Category.tenant_id == user.tenant_id
        )
    )
    category = result.scalar_one_or_none()
    if category is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")

    await db.delete(category)
    await db.commit()
