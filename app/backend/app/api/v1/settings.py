"""Tenant-level settings (queue strategy, schedule, business profile).

The queue model has two scheduling modes (selected via ``queue_schedule_mode``):

* ``times`` — release at every ``HH:MM`` listed in ``queue_schedule_times``.
* ``interval`` — release every ``queue_schedule_interval_minutes`` minutes,
  anchored at 00:00 UTC. ``5`` = every five minutes, ``120`` = every two hours.

Both modes drain the *entire* queue per fire — there is no per-tick cap.

The business profile is split across three tables (``tenant_currencies``,
``tenant_organizations``, ``tenant_branches``) so a tenant can keep a list of
currencies (each with its own daily exchange rate), legal entities, and
branches (each anchored to one organization).
"""
from __future__ import annotations

import re
from datetime import date as _date
from decimal import Decimal, InvalidOperation
from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select, update

from app.db.models import (
    Tenant,
    TenantBranch,
    TenantCurrency,
    TenantOrganization,
    TenantUser,
)
from app.db.models.tenant import DEFAULT_QUEUE_SCHEDULE_TIMES
from app.deps import CurrentUserDep, DbSession

router = APIRouter(prefix="/settings", tags=["settings"])

_HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
_MIN_INTERVAL = 1
_MAX_INTERVAL = 24 * 60  # one day


class TenantSettingsOut(BaseModel):
    queue_strategy: str = Field(description='Either "immediate" or "queued".')
    queue_schedule_mode: str = Field(description='Either "times" or "interval".')
    queue_schedule_times: list[str] = Field(
        description='List of "HH:MM" 24h release times (UTC). Used when mode="times".',
    )
    queue_schedule_interval_minutes: int = Field(
        description='Minutes between releases when mode="interval". '
                    f'Between {_MIN_INTERVAL} and {_MAX_INTERVAL}.',
    )
    # Kept for backward compatibility; no longer read by the queue logic.
    queue_throttle_per_minute: int


class TenantSettingsIn(BaseModel):
    queue_strategy: str = Field(pattern="^(immediate|queued)$")
    queue_schedule_mode: str = Field(default="times", pattern="^(times|interval)$")
    queue_schedule_times: list[str] = Field(
        default_factory=lambda: list(DEFAULT_QUEUE_SCHEDULE_TIMES),
        max_length=24,
    )
    queue_schedule_interval_minutes: int = Field(
        default=60, ge=_MIN_INTERVAL, le=_MAX_INTERVAL,
    )

    @field_validator("queue_schedule_times")
    @classmethod
    def _valid_times(cls, v: list[str]) -> list[str]:
        cleaned: list[str] = []
        for raw in v:
            s = (raw or "").strip()
            if not _HHMM.match(s):
                raise ValueError(f"invalid_time: {raw!r}, expected HH:MM 24h")
            if s not in cleaned:
                cleaned.append(s)
        cleaned.sort()
        return cleaned

    def model_post_init(self, __context) -> None:
        # Mode-specific sanity: only enforce non-empty times when the active
        # mode actually needs them. Interval mode tolerates an empty times list.
        if self.queue_schedule_mode == "times" and not self.queue_schedule_times:
            raise ValueError("queue_schedule_times: at least one time required when mode='times'")


def _out(t: Tenant) -> TenantSettingsOut:
    times_raw = getattr(t, "queue_schedule_times", None)
    times = list(times_raw) if isinstance(times_raw, list) and times_raw else list(DEFAULT_QUEUE_SCHEDULE_TIMES)
    mode = getattr(t, "queue_schedule_mode", None) or "times"
    interval = int(getattr(t, "queue_schedule_interval_minutes", None) or 60)
    throttle = int(getattr(t, "queue_throttle_per_minute", None) or 60)
    return TenantSettingsOut(
        queue_strategy=t.queue_strategy,
        queue_schedule_mode=mode,
        queue_schedule_times=times,
        queue_schedule_interval_minutes=interval,
        queue_throttle_per_minute=throttle,
    )


@router.get("/tenant", response_model=TenantSettingsOut)
async def get_tenant_settings(user: CurrentUserDep, db: DbSession) -> TenantSettingsOut:
    t = await db.scalar(select(Tenant).where(Tenant.id == user.tenant_id))
    if t is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "tenant_missing")
    return _out(t)


@router.put("/tenant", response_model=TenantSettingsOut)
async def put_tenant_settings(
    body: TenantSettingsIn, user: CurrentUserDep, db: DbSession,
) -> TenantSettingsOut:
    if user.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "admin_role_required")
    t = await db.scalar(select(Tenant).where(Tenant.id == user.tenant_id))
    if t is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "tenant_missing")
    t.queue_strategy = body.queue_strategy
    t.queue_schedule_mode = body.queue_schedule_mode
    t.queue_schedule_times = body.queue_schedule_times
    t.queue_schedule_interval_minutes = body.queue_schedule_interval_minutes
    await db.commit()
    await db.refresh(t)
    return _out(t)


# ---------------------------------------------------------------------------
# Business profile — tenant identity used on every invoice
# ---------------------------------------------------------------------------


_ISO_CURRENCY = re.compile(r"^[A-Z]{3}$")


class BusinessSettingsOut(BaseModel):
    tenant_id: str
    name: str = Field(description="Legal entity name. Set at signup; not editable here.")
    vat_number: str
    organization_identifier: str
    currency: str = Field(description="ISO 4217 currency code, e.g. SAR.")
    trade_name: str | None = Field(
        description="Display/marketing name. Falls back to the legal name when empty.",
    )
    branch_name: str | None = Field(
        description="Branch/location identifier for multi-branch tenants.",
    )


class BusinessSettingsIn(BaseModel):
    currency: str = Field(default="SAR", min_length=3, max_length=3)
    trade_name: str | None = Field(default=None, max_length=200)
    branch_name: str | None = Field(default=None, max_length=200)

    @field_validator("currency")
    @classmethod
    def _valid_currency(cls, v: str) -> str:
        s = (v or "SAR").strip().upper()
        if not _ISO_CURRENCY.match(s):
            raise ValueError("currency must be 3 uppercase ASCII letters (ISO 4217)")
        return s

    @field_validator("trade_name", "branch_name")
    @classmethod
    def _trim_optional(cls, v: str | None) -> str | None:
        if v is None:
            return None
        s = v.strip()
        return s or None


def _business_out(t: Tenant) -> BusinessSettingsOut:
    return BusinessSettingsOut(
        tenant_id=str(t.id),
        name=t.name,
        vat_number=t.vat_number,
        organization_identifier=t.organization_identifier,
        currency=(getattr(t, "currency", None) or "SAR"),
        trade_name=getattr(t, "trade_name", None),
        branch_name=getattr(t, "branch_name", None),
    )


@router.get("/business", response_model=BusinessSettingsOut)
async def get_business_settings(user: CurrentUserDep, db: DbSession) -> BusinessSettingsOut:
    t = await db.scalar(select(Tenant).where(Tenant.id == user.tenant_id))
    if t is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "tenant_missing")
    return _business_out(t)


@router.put("/business", response_model=BusinessSettingsOut)
async def put_business_settings(
    body: BusinessSettingsIn, user: CurrentUserDep, db: DbSession,
) -> BusinessSettingsOut:
    if user.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "admin_role_required")
    t = await db.scalar(select(Tenant).where(Tenant.id == user.tenant_id))
    if t is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "tenant_missing")
    t.currency = body.currency
    t.trade_name = body.trade_name
    t.branch_name = body.branch_name
    await db.commit()
    await db.refresh(t)
    return _business_out(t)


# ===========================================================================
# Multi-currency CRUD
# Rates are quoted as "1 unit of `code` = exchange_rate units of the base
# (default) currency". The default currency itself must have rate = 1.
# ===========================================================================


def _admin_only(user) -> None:
    if user.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "admin_role_required")


class CurrencyOut(BaseModel):
    id: str
    code: str
    exchange_rate: str          # serialised as string to preserve precision
    as_of_date: _date
    is_default: bool


class CurrencyIn(BaseModel):
    code: str = Field(min_length=3, max_length=3)
    exchange_rate: str = Field(default="1")
    as_of_date: _date | None = None
    is_default: bool = False

    @field_validator("code")
    @classmethod
    def _code(cls, v: str) -> str:
        s = (v or "").strip().upper()
        if not _ISO_CURRENCY.match(s):
            raise ValueError("currency code must be 3 uppercase ASCII letters")
        return s

    @field_validator("exchange_rate")
    @classmethod
    def _rate(cls, v: str) -> str:
        try:
            d = Decimal(str(v))
        except (InvalidOperation, ValueError) as e:
            raise ValueError("exchange_rate must be a decimal") from e
        if d <= 0:
            raise ValueError("exchange_rate must be > 0")
        return format(d.normalize(), "f")


def _currency_out(c: TenantCurrency) -> CurrencyOut:
    return CurrencyOut(
        id=str(c.id),
        code=c.code,
        exchange_rate=format(Decimal(c.exchange_rate), "f"),
        as_of_date=c.as_of_date,
        is_default=bool(c.is_default),
    )


async def _list_tenant_currencies(db, tenant_id: UUID) -> list[TenantCurrency]:
    return list((await db.execute(
        select(TenantCurrency)
        .where(TenantCurrency.tenant_id == tenant_id)
        .order_by(TenantCurrency.is_default.desc(), TenantCurrency.code.asc())
    )).scalars().all())


async def _ensure_seed_currency(db, tenant_id: UUID) -> None:
    """Make sure the tenant has at least one currency. Seeds SAR @ rate=1 as
    the default when the list is empty. Idempotent."""
    rows = await _list_tenant_currencies(db, tenant_id)
    if rows:
        return
    db.add(TenantCurrency(
        tenant_id=tenant_id, code="SAR",
        exchange_rate=Decimal("1"), as_of_date=_date.today(), is_default=True,
    ))
    await db.commit()


@router.get("/currencies", response_model=list[CurrencyOut])
async def list_currencies(user: CurrentUserDep, db: DbSession) -> list[CurrencyOut]:
    await _ensure_seed_currency(db, user.tenant_id)
    return [_currency_out(c) for c in await _list_tenant_currencies(db, user.tenant_id)]


@router.post("/currencies", response_model=CurrencyOut, status_code=status.HTTP_201_CREATED)
async def add_currency(body: CurrencyIn, user: CurrentUserDep, db: DbSession) -> CurrencyOut:
    _admin_only(user)
    # Unique per (tenant, code) — return a friendly 409 instead of a Postgres error.
    existing = await db.scalar(
        select(TenantCurrency).where(
            TenantCurrency.tenant_id == user.tenant_id,
            TenantCurrency.code == body.code,
        )
    )
    if existing is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, f"currency_exists:{body.code}")
    row = TenantCurrency(
        tenant_id=user.tenant_id, code=body.code,
        exchange_rate=Decimal(body.exchange_rate),
        as_of_date=body.as_of_date or _date.today(),
        is_default=body.is_default,
    )
    db.add(row)
    if body.is_default:
        await db.flush()
        await _make_only_default(db, user.tenant_id, TenantCurrency, row.id)
    await db.commit()
    await db.refresh(row)
    return _currency_out(row)


@router.patch("/currencies/{currency_id}", response_model=CurrencyOut)
async def update_currency(
    currency_id: UUID, body: CurrencyIn, user: CurrentUserDep, db: DbSession,
) -> CurrencyOut:
    _admin_only(user)
    row = await db.scalar(
        select(TenantCurrency).where(
            TenantCurrency.id == currency_id, TenantCurrency.tenant_id == user.tenant_id,
        )
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "currency_not_found")
    if body.code != row.code:
        # Block renaming into an existing code.
        clash = await db.scalar(
            select(TenantCurrency).where(
                TenantCurrency.tenant_id == user.tenant_id,
                TenantCurrency.code == body.code,
                TenantCurrency.id != currency_id,
            )
        )
        if clash is not None:
            raise HTTPException(status.HTTP_409_CONFLICT, f"currency_exists:{body.code}")
        row.code = body.code
    row.exchange_rate = Decimal(body.exchange_rate)
    row.as_of_date = body.as_of_date or row.as_of_date
    if body.is_default and not row.is_default:
        await _make_only_default(db, user.tenant_id, TenantCurrency, row.id)
    elif not body.is_default and row.is_default:
        # Forbid clearing the default without selecting a replacement.
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "set_another_default_first",
        )
    await db.commit()
    await db.refresh(row)
    return _currency_out(row)


@router.delete("/currencies/{currency_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_currency(currency_id: UUID, user: CurrentUserDep, db: DbSession) -> None:
    _admin_only(user)
    row = await db.scalar(
        select(TenantCurrency).where(
            TenantCurrency.id == currency_id, TenantCurrency.tenant_id == user.tenant_id,
        )
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "currency_not_found")
    if row.is_default:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "cannot_delete_default")
    await db.delete(row)
    await db.commit()


# ===========================================================================
# Multi-organization CRUD
# ===========================================================================


class OrganizationOut(BaseModel):
    id: str
    name: str
    trade_name: str | None
    vat_number: str | None
    registration_number: str | None
    street: str | None
    building_number: str | None
    city_subdivision: str | None
    city: str | None
    postal_zone: str | None
    country_code: str
    is_default: bool


class OrganizationIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    trade_name: str | None = Field(default=None, max_length=200)
    vat_number: str | None = Field(default=None, max_length=15)
    registration_number: str | None = Field(default=None, max_length=50)
    street: str | None = Field(default=None, max_length=200)
    building_number: str | None = Field(default=None, max_length=20)
    city_subdivision: str | None = Field(default=None, max_length=100)
    city: str | None = Field(default=None, max_length=100)
    postal_zone: str | None = Field(default=None, max_length=20)
    country_code: str = Field(default="SA", min_length=2, max_length=2)
    is_default: bool = False

    @field_validator("country_code")
    @classmethod
    def _country(cls, v: str) -> str:
        s = (v or "SA").strip().upper()
        if len(s) != 2 or not s.isalpha():
            raise ValueError("country_code must be 2 letters")
        return s

    @field_validator(
        "trade_name", "vat_number", "registration_number",
        "street", "building_number", "city_subdivision", "city", "postal_zone",
    )
    @classmethod
    def _trim(cls, v: str | None) -> str | None:
        if v is None:
            return None
        s = v.strip()
        return s or None


def _org_out(o: TenantOrganization) -> OrganizationOut:
    return OrganizationOut(
        id=str(o.id), name=o.name, trade_name=o.trade_name,
        vat_number=o.vat_number, registration_number=o.registration_number,
        street=o.street, building_number=o.building_number,
        city_subdivision=o.city_subdivision, city=o.city,
        postal_zone=o.postal_zone, country_code=o.country_code,
        is_default=bool(o.is_default),
    )


async def _list_tenant_orgs(db, tenant_id: UUID) -> list[TenantOrganization]:
    return list((await db.execute(
        select(TenantOrganization)
        .where(TenantOrganization.tenant_id == tenant_id)
        .order_by(TenantOrganization.is_default.desc(), TenantOrganization.name.asc())
    )).scalars().all())


async def _ensure_seed_org(db, tenant: Tenant) -> None:
    rows = await _list_tenant_orgs(db, tenant.id)
    if rows:
        return
    db.add(TenantOrganization(
        tenant_id=tenant.id, name=tenant.name,
        trade_name=getattr(tenant, "trade_name", None),
        vat_number=tenant.vat_number,
        registration_number=tenant.organization_identifier,
        country_code="SA", is_default=True,
    ))
    await db.commit()


@router.get("/organizations", response_model=list[OrganizationOut])
async def list_organizations(user: CurrentUserDep, db: DbSession) -> list[OrganizationOut]:
    t = await db.scalar(select(Tenant).where(Tenant.id == user.tenant_id))
    if t is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "tenant_missing")
    await _ensure_seed_org(db, t)
    return [_org_out(o) for o in await _list_tenant_orgs(db, user.tenant_id)]


@router.post("/organizations", response_model=OrganizationOut, status_code=status.HTTP_201_CREATED)
async def add_organization(body: OrganizationIn, user: CurrentUserDep, db: DbSession) -> OrganizationOut:
    _admin_only(user)
    row = TenantOrganization(tenant_id=user.tenant_id, **body.model_dump())
    db.add(row)
    if body.is_default:
        await db.flush()
        await _make_only_default(db, user.tenant_id, TenantOrganization, row.id)
    await db.commit()
    await db.refresh(row)
    return _org_out(row)


@router.patch("/organizations/{org_id}", response_model=OrganizationOut)
async def update_organization(
    org_id: UUID, body: OrganizationIn, user: CurrentUserDep, db: DbSession,
) -> OrganizationOut:
    _admin_only(user)
    row = await db.scalar(
        select(TenantOrganization).where(
            TenantOrganization.id == org_id,
            TenantOrganization.tenant_id == user.tenant_id,
        )
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "organization_not_found")
    for k, v in body.model_dump().items():
        if k == "is_default":
            continue
        setattr(row, k, v)
    if body.is_default and not row.is_default:
        await _make_only_default(db, user.tenant_id, TenantOrganization, row.id)
    elif not body.is_default and row.is_default:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "set_another_default_first")
    await db.commit()
    await db.refresh(row)
    return _org_out(row)


@router.delete("/organizations/{org_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_organization(org_id: UUID, user: CurrentUserDep, db: DbSession) -> None:
    _admin_only(user)
    row = await db.scalar(
        select(TenantOrganization).where(
            TenantOrganization.id == org_id,
            TenantOrganization.tenant_id == user.tenant_id,
        )
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "organization_not_found")
    if row.is_default:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "cannot_delete_default")
    await db.delete(row)
    await db.commit()


# ===========================================================================
# Multi-branch CRUD — each branch is anchored to one organization
# ===========================================================================


class BranchOut(BaseModel):
    id: str
    organization_id: str
    name: str
    code: str | None
    street: str | None
    building_number: str | None
    city_subdivision: str | None
    city: str | None
    postal_zone: str | None
    country_code: str
    is_default: bool


class BranchIn(BaseModel):
    organization_id: UUID
    name: str = Field(min_length=1, max_length=200)
    code: str | None = Field(default=None, max_length=50)
    street: str | None = Field(default=None, max_length=200)
    building_number: str | None = Field(default=None, max_length=20)
    city_subdivision: str | None = Field(default=None, max_length=100)
    city: str | None = Field(default=None, max_length=100)
    postal_zone: str | None = Field(default=None, max_length=20)
    country_code: str = Field(default="SA", min_length=2, max_length=2)
    is_default: bool = False

    @field_validator("country_code")
    @classmethod
    def _country(cls, v: str) -> str:
        s = (v or "SA").strip().upper()
        if len(s) != 2 or not s.isalpha():
            raise ValueError("country_code must be 2 letters")
        return s

    @field_validator(
        "code", "street", "building_number", "city_subdivision",
        "city", "postal_zone",
    )
    @classmethod
    def _trim(cls, v: str | None) -> str | None:
        if v is None:
            return None
        s = v.strip()
        return s or None


def _branch_out(b: TenantBranch) -> BranchOut:
    return BranchOut(
        id=str(b.id), organization_id=str(b.organization_id), name=b.name,
        code=b.code, street=b.street, building_number=b.building_number,
        city_subdivision=b.city_subdivision, city=b.city,
        postal_zone=b.postal_zone, country_code=b.country_code,
        is_default=bool(b.is_default),
    )


@router.get("/branches", response_model=list[BranchOut])
async def list_branches(user: CurrentUserDep, db: DbSession) -> list[BranchOut]:
    rows = (await db.execute(
        select(TenantBranch)
        .where(TenantBranch.tenant_id == user.tenant_id)
        .order_by(TenantBranch.is_default.desc(), TenantBranch.name.asc())
    )).scalars().all()
    return [_branch_out(b) for b in rows]


async def _assert_org_owned(db, tenant_id: UUID, org_id: UUID) -> None:
    org = await db.scalar(
        select(TenantOrganization).where(
            TenantOrganization.id == org_id,
            TenantOrganization.tenant_id == tenant_id,
        )
    )
    if org is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "organization_not_in_tenant")


@router.post("/branches", response_model=BranchOut, status_code=status.HTTP_201_CREATED)
async def add_branch(body: BranchIn, user: CurrentUserDep, db: DbSession) -> BranchOut:
    _admin_only(user)
    await _assert_org_owned(db, user.tenant_id, body.organization_id)
    row = TenantBranch(tenant_id=user.tenant_id, **body.model_dump())
    db.add(row)
    if body.is_default:
        await db.flush()
        await _make_only_default(db, user.tenant_id, TenantBranch, row.id)
    await db.commit()
    await db.refresh(row)
    return _branch_out(row)


@router.patch("/branches/{branch_id}", response_model=BranchOut)
async def update_branch(
    branch_id: UUID, body: BranchIn, user: CurrentUserDep, db: DbSession,
) -> BranchOut:
    _admin_only(user)
    row = await db.scalar(
        select(TenantBranch).where(
            TenantBranch.id == branch_id, TenantBranch.tenant_id == user.tenant_id,
        )
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "branch_not_found")
    await _assert_org_owned(db, user.tenant_id, body.organization_id)
    for k, v in body.model_dump().items():
        if k == "is_default":
            continue
        setattr(row, k, v)
    if body.is_default and not row.is_default:
        await _make_only_default(db, user.tenant_id, TenantBranch, row.id)
    elif not body.is_default and row.is_default:
        # branches don't *require* a default — allow clearing.
        row.is_default = False
    await db.commit()
    await db.refresh(row)
    return _branch_out(row)


@router.delete("/branches/{branch_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_branch(branch_id: UUID, user: CurrentUserDep, db: DbSession) -> None:
    _admin_only(user)
    row = await db.scalar(
        select(TenantBranch).where(
            TenantBranch.id == branch_id, TenantBranch.tenant_id == user.tenant_id,
        )
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "branch_not_found")
    await db.delete(row)
    await db.commit()


# ---------------------------------------------------------------------------
# Helper used by all three CRUD sets — guarantees exactly one ``is_default``
# row per (tenant, model). Uses an UPDATE rather than per-row writes so the
# partial-unique index never sees two defaults during the transaction.
# ---------------------------------------------------------------------------


async def _make_only_default(db, tenant_id: UUID, model, keep_id: UUID) -> None:
    await db.execute(
        update(model)
        .where(model.tenant_id == tenant_id, model.id != keep_id)
        .values(is_default=False)
    )
    await db.execute(
        update(model).where(model.id == keep_id).values(is_default=True)
    )


# ---------------------------------------------------------------------------
# Per-user UI preferences (page size, soft daily quotas).
#
# Authoritative copy lives in the DB on `tenant_users` so:
#   - changes by user A never overwrite user B's prefs (scoped to user_id),
#   - multiple browsers / devices see the same values,
#   - no stale localStorage cache can drift from the truth.
#
# The frontend reads via GET and writes via PUT — never localStorage.
# ---------------------------------------------------------------------------

_PAGE_SIZE_CHOICES = {10, 25, 50, 100}


class UserPreferencesOut(BaseModel):
    page_size: int
    reported_daily_quota: int
    clearance_daily_quota: int
    updated_at: str  # ISO timestamp — clients can use for cache-busting / sync


class UserPreferencesIn(BaseModel):
    page_size: int | None = Field(default=None)
    reported_daily_quota: int | None = Field(default=None, ge=0)
    clearance_daily_quota: int | None = Field(default=None, ge=0)

    @field_validator("page_size")
    @classmethod
    def _check_page_size(cls, v: int | None) -> int | None:
        if v is not None and v not in _PAGE_SIZE_CHOICES:
            raise ValueError(f"page_size must be one of {sorted(_PAGE_SIZE_CHOICES)}")
        return v


def _user_prefs_out(row: TenantUser) -> UserPreferencesOut:
    return UserPreferencesOut(
        page_size=row.page_size,
        reported_daily_quota=row.reported_daily_quota,
        clearance_daily_quota=row.clearance_daily_quota,
        updated_at=row.updated_at.isoformat() if row.updated_at else "",
    )


@router.get("/user-preferences", response_model=UserPreferencesOut)
async def get_user_preferences(
    user: CurrentUserDep, db: DbSession
) -> UserPreferencesOut:
    row = await db.scalar(
        select(TenantUser).where(TenantUser.id == user.user_id)
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user_not_found")
    return _user_prefs_out(row)


@router.put("/user-preferences", response_model=UserPreferencesOut)
async def update_user_preferences(
    body: UserPreferencesIn, user: CurrentUserDep, db: DbSession
) -> UserPreferencesOut:
    """Partial update — only fields explicitly sent are touched. The row is
    scoped to (user_id, tenant_id) so two users in the same tenant can't
    overwrite each other.
    """
    row = await db.scalar(
        select(TenantUser).where(
            TenantUser.id == user.user_id, TenantUser.tenant_id == user.tenant_id,
        )
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user_not_found")
    if body.page_size is not None:
        row.page_size = body.page_size
    if body.reported_daily_quota is not None:
        row.reported_daily_quota = body.reported_daily_quota
    if body.clearance_daily_quota is not None:
        row.clearance_daily_quota = body.clearance_daily_quota
    await db.commit()
    await db.refresh(row)
    return _user_prefs_out(row)
