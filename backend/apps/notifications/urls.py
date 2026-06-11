import secrets
from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.deps import CurrentUserDep, DbSession
from apps.notifications.models import Webhook
from apps.notifications.schemas import WebhookCreate, WebhookRead, WebhookUpdate

router = APIRouter(prefix="/webhooks", tags=["webhooks"])


@router.get("", response_model=list[WebhookRead])
async def list_webhooks(user: CurrentUserDep, db: DbSession):
    result = await db.execute(
        select(Webhook).where(Webhook.tenant_id == user.tenant_id)
    )
    return result.scalars().all()


@router.post("", response_model=WebhookRead, status_code=status.HTTP_201_CREATED)
async def create_webhook(payload: WebhookCreate, user: CurrentUserDep, db: DbSession):
    webhook = Webhook(
        tenant_id=user.tenant_id,
        url=payload.url,
        secret=payload.secret or secrets.token_hex(32),
        events=payload.events,
        enabled=payload.enabled,
    )
    db.add(webhook)
    await db.commit()
    await db.refresh(webhook)
    return webhook


@router.get("/{id}", response_model=WebhookRead)
async def get_webhook(id: UUID, user: CurrentUserDep, db: DbSession):
    result = await db.execute(
        select(Webhook).where(
            Webhook.id == id,
            Webhook.tenant_id == user.tenant_id,
        )
    )
    webhook = result.scalar_one_or_none()
    if webhook is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Webhook not found")
    return webhook


@router.patch("/{id}", response_model=WebhookRead)
async def update_webhook(id: UUID, payload: WebhookUpdate, user: CurrentUserDep, db: DbSession):
    result = await db.execute(
        select(Webhook).where(
            Webhook.id == id,
            Webhook.tenant_id == user.tenant_id,
        )
    )
    webhook = result.scalar_one_or_none()
    if webhook is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Webhook not found")

    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(webhook, field, value)

    await db.commit()
    await db.refresh(webhook)
    return webhook


@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_webhook(id: UUID, user: CurrentUserDep, db: DbSession):
    result = await db.execute(
        select(Webhook).where(
            Webhook.id == id,
            Webhook.tenant_id == user.tenant_id,
        )
    )
    webhook = result.scalar_one_or_none()
    if webhook is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Webhook not found")

    await db.delete(webhook)
    await db.commit()
