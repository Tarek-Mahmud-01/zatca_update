"""Seed the tenant with a sensible starter dataset.

Idempotent — re-running the script either updates rows in place or skips when
the entity already exists. Creates:

  1 tenant         — Demo Tenant (vat 300000000000003)
  3 team members   — 1 admin (admin@demo.local), 1 member, 1 viewer
  4 categories     — Office supplies, Coffee & beverages, Electronics, Services
 12 products       — spread across categories with mixed VAT codes
  6 customers      — B2B and B2C variety, real-ish KSA addresses

Run:
    .venv/Scripts/python.exe -m app.scripts.seed
"""
from __future__ import annotations

import asyncio
import os
from decimal import Decimal

from sqlalchemy import select

from app.db.models import Category, Customer, Product, Tenant, TenantUser
from app.db.session import SessionLocal
from app.security import hash_password


# ---------------------------------------------------------------------------
# Tenant + users
# ---------------------------------------------------------------------------

DEFAULT_TENANT = {
    "name":                    os.environ.get("SEED_TENANT_NAME", "Demo Tenant"),
    "vat_number":              os.environ.get("SEED_VAT_NUMBER",  "300000000000003"),
    "organization_identifier": os.environ.get("SEED_ORG_ID",      "300000000000003"),
}

DEFAULT_USERS = [
    {"email": os.environ.get("SEED_EMAIL", "admin@demo.local"),
     "password": os.environ.get("SEED_PASSWORD", "ChangeMe123!"),
     "role": "admin"},
    {"email": "member@demo.local",
     "password": "MemberPass123",
     "role": "member"},
    {"email": "viewer@demo.local",
     "password": "ViewerPass123",
     "role": "viewer"},
]


# ---------------------------------------------------------------------------
# Catalog
# ---------------------------------------------------------------------------

CATEGORIES = [
    {"name": "Office supplies",     "description": "Paper, pens, stationery and consumables."},
    {"name": "Coffee & beverages",  "description": "Coffee beans, ground, capsules and brewing accessories."},
    {"name": "Electronics",         "description": "Computer accessories, peripherals, cables."},
    {"name": "Services",            "description": "Professional services billed by the hour or project."},
]

PRODUCTS = [
    # SKU,       Name,                                  Category,                Unit price, Unit, VAT cat, VAT %
    ("SUP-001",  "A4 Paper Ream (500 sheets)",          "Office supplies",       "18.00",    "PCE", "S",  "15"),
    ("SUP-002",  "Black Pen — Pack of 12",              "Office supplies",       "24.50",    "PCE", "S",  "15"),
    ("SUP-003",  "Sticky Notes Set (5 colors)",         "Office supplies",       "12.00",    "PCE", "S",  "15"),
    ("BEV-001",  "Arabic Coffee Beans 250g",            "Coffee & beverages",    "45.00",    "PCE", "S",  "15"),
    ("BEV-002",  "Espresso Capsules — Box of 30",       "Coffee & beverages",    "78.00",    "PCE", "S",  "15"),
    ("BEV-003",  "Bottled Water 500ml — 24-pack",       "Coffee & beverages",    "15.00",    "PCE", "Z",  "0"),
    ("ELE-001",  "USB-C Cable 1m",                       "Electronics",           "32.00",    "PCE", "S",  "15"),
    ("ELE-002",  "Wireless Mouse",                       "Electronics",           "85.00",    "PCE", "S",  "15"),
    ("ELE-003",  "27\" Monitor — 4K IPS",                "Electronics",           "1450.00",  "PCE", "S",  "15"),
    ("SVC-001",  "Consulting hour",                      "Services",              "300.00",   "HUR", "S",  "15"),
    ("SVC-002",  "On-site installation visit",           "Services",              "750.00",   "PCE", "S",  "15"),
    ("SVC-003",  "Training session (full day)",          "Services",              "2200.00",  "DAY", "S",  "15"),
]

CUSTOMERS = [
    {
        "external_id": "CUST-0001",
        "name": "Falcon Logistics Co.",
        "vat_number": "310123456700003",
        "crn": "1010234567",
        "email": "billing@falcon-logistics.sa",
        "phone": "+966-11-401-9120",
        "street": "King Fahd Road",
        "building_number": "2150",
        "city_subdivision": "Al Olaya",
        "city": "Riyadh",
        "postal_zone": "12211",
        "country_code": "SA",
    },
    {
        "external_id": "CUST-0002",
        "name": "Arabian Gulf Construction LTD",
        "vat_number": "311456789000003",
        "crn": "2050456789",
        "email": "ap@agconstruction.sa",
        "phone": "+966-13-865-7700",
        "street": "Prince Mohammed Bin Fahd Rd",
        "building_number": "7820",
        "city_subdivision": "Al Khobar Al Janubiyah",
        "city": "Al Khobar",
        "postal_zone": "31952",
        "country_code": "SA",
    },
    {
        "external_id": "CUST-0003",
        "name": "Maximum Speed Tech Supply LTD",
        "vat_number": "399999999800003",
        "crn": "1010987654",
        "email": "purchasing@maxspeed.sa",
        "phone": "+966-12-660-4400",
        "street": "Madinah Road",
        "building_number": "4400",
        "city_subdivision": "Al Salamah",
        "city": "Jeddah",
        "postal_zone": "23437",
        "country_code": "SA",
    },
    {
        "external_id": "CUST-0004",
        "name": "Saudi Petroleum Services Co.",
        "vat_number": "312987654300003",
        "crn": "1010123456",
        "email": "vendor.invoices@sapsc.com",
        "phone": "+966-11-201-3900",
        "street": "Northern Ring Road",
        "building_number": "315",
        "city_subdivision": "Al Sahafah",
        "city": "Riyadh",
        "postal_zone": "13315",
        "country_code": "SA",
    },
    {
        "external_id": "CUST-0005",
        "name": "Khalid Al-Mutairi",  # individual buyer (B2C-style)
        "vat_number": None,
        "crn": None,
        "email": "khalid.almutairi@example.com",
        "phone": "+966-50-122-3344",
        "street": "Al Tahliya St",
        "building_number": "88",
        "city_subdivision": "Al Olaya",
        "city": "Riyadh",
        "postal_zone": "12244",
        "country_code": "SA",
    },
    {
        "external_id": "CUST-0006",
        "name": "Foreign Buyer GmbH",  # export customer (non-SA)
        "vat_number": None,
        "crn": None,
        "email": "ap@foreign-buyer.de",
        "phone": "+49-30-555-0102",
        "street": "Friedrichstrasse",
        "building_number": "50",
        "city_subdivision": "Mitte",
        "city": "Berlin",
        "postal_zone": "10117",
        "country_code": "DE",
    },
]


# ---------------------------------------------------------------------------
# Helpers — idempotent upserts
# ---------------------------------------------------------------------------


async def _get_or_create_tenant(db) -> Tenant:
    existing = await db.scalar(
        select(Tenant).where(Tenant.vat_number == DEFAULT_TENANT["vat_number"])
    )
    if existing is not None:
        print(f"[skip] tenant exists: {existing.name} ({existing.id})")
        return existing
    t = Tenant(**DEFAULT_TENANT)
    db.add(t)
    await db.flush()
    print(f"[ok]   tenant created: {t.name} ({t.id})")
    return t


async def _upsert_users(db, tenant: Tenant) -> None:
    for spec in DEFAULT_USERS:
        existing = await db.scalar(
            select(TenantUser).where(
                TenantUser.tenant_id == tenant.id, TenantUser.email == spec["email"]
            )
        )
        if existing is not None:
            print(f"[skip] user exists: {spec['email']} ({existing.role})")
            continue
        db.add(TenantUser(
            tenant_id=tenant.id,
            email=spec["email"],
            hashed_password=hash_password(spec["password"]),
            role=spec["role"],
        ))
        print(f"[ok]   user created: {spec['email']} ({spec['role']}) / {spec['password']}")


async def _upsert_categories(db, tenant: Tenant) -> dict[str, Category]:
    by_name: dict[str, Category] = {}
    for spec in CATEGORIES:
        existing = await db.scalar(
            select(Category).where(Category.tenant_id == tenant.id, Category.name == spec["name"])
        )
        if existing is not None:
            by_name[spec["name"]] = existing
            print(f"[skip] category exists: {spec['name']}")
            continue
        c = Category(tenant_id=tenant.id, **spec)
        db.add(c)
        await db.flush()
        by_name[spec["name"]] = c
        print(f"[ok]   category: {spec['name']}")
    return by_name


async def _upsert_products(db, tenant: Tenant, cats: dict[str, Category]) -> None:
    for sku, name, cat_name, price, unit, tax_cat, tax_pct in PRODUCTS:
        existing = await db.scalar(
            select(Product).where(Product.tenant_id == tenant.id, Product.sku == sku)
        )
        if existing is not None:
            print(f"[skip] product exists: {sku}")
            continue
        p = Product(
            tenant_id=tenant.id,
            category_id=cats[cat_name].id if cat_name in cats else None,
            sku=sku, name=name,
            unit_price=Decimal(price), unit_code=unit,
            tax_category=tax_cat, tax_percent=Decimal(tax_pct),
        )
        db.add(p)
        print(f"[ok]   product: {sku} {name}")


async def _upsert_customers(db, tenant: Tenant) -> None:
    for spec in CUSTOMERS:
        existing = await db.scalar(
            select(Customer).where(
                Customer.tenant_id == tenant.id, Customer.external_id == spec["external_id"]
            )
        )
        if existing is not None:
            print(f"[skip] customer exists: {spec['external_id']} {spec['name']}")
            continue
        db.add(Customer(tenant_id=tenant.id, **spec))
        print(f"[ok]   customer: {spec['external_id']} {spec['name']}")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


async def seed() -> None:
    async with SessionLocal() as db:
        tenant = await _get_or_create_tenant(db)
        await _upsert_users(db, tenant)
        cats = await _upsert_categories(db, tenant)
        await _upsert_products(db, tenant, cats)
        await _upsert_customers(db, tenant)
        await db.commit()

    print()
    print("Login at:  http://localhost:3000/login")
    print(f"Admin:     {DEFAULT_USERS[0]['email']} / {DEFAULT_USERS[0]['password']}")
    print(f"Member:    {DEFAULT_USERS[1]['email']} / {DEFAULT_USERS[1]['password']}")
    print(f"Viewer:    {DEFAULT_USERS[2]['email']} / {DEFAULT_USERS[2]['password']}")


if __name__ == "__main__":
    asyncio.run(seed())
