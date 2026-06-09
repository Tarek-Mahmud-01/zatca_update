# FastAPI — Django-style, app-based layered architecture

A production-grade FastAPI backend organized like Django: each domain is an
**app** with its own `models`, `views`, `urls`, plus strict layer separation
(`schemas`, `repository`, `service`, `permissions`, `validators`, `exceptions`,
`tasks`, `constants`, `utils`). The project root only mounts each app's base
router.

## Folder structure

Flat, app-wise layout — each app is a top-level package; no deep nesting.

```
fastapi_backend/
├─ main.py                    # ROOT: CORS + exception handlers + mounts app routers ONLY
├─ core/                      # framework-agnostic shared building blocks
│  ├─ config.py               # typed settings (pydantic-settings)
│  ├─ database.py             # async engine, session factory, Base, get_db
│  ├─ mixins.py               # UUID + timestamp column mixins
│  ├─ repository.py           # BaseRepository[Model]  ← the only ORM layer
│  ├─ service.py              # BaseService (unit of work)
│  ├─ responses.py            # success()/error() envelope + Meta
│  ├─ exceptions.py           # AppException hierarchy
│  ├─ exception_handlers.py   # centralized handlers (one error shape)
│  ├─ pagination.py           # PageParams + paginate()
│  ├─ security.py             # JWT + password hashing
│  ├─ deps.py                 # get_db, get_current_user (JWT)
│  ├─ permissions.py          # require_roles() RBAC dependency
│  ├─ celery_app.py           # Celery app + autodiscovery
│  ├─ constants.py / utils.py
├─ user/                      # auth + RBAC app
│  ├─ models.py  schemas.py  repository.py  service.py
│  ├─ views.py   urls.py     permissions.py validators.py
│  ├─ exceptions.py tasks.py constants.py   utils.py
│  └─ tests/
├─ invoice/                   # ORM-optimization showcase (owner FK + line items)
│  └─ … same layers …
├─ finance/                   # Currency (1) → ExchangeRate (many); joined list, bulk import
├─ settings/                  # per-user key/value preferences (upsert, self-scoped)
├─ account/                   # self-service profile + change-password (reuses user.User)
├─ scripts/create_tables.py   # dev only; use Alembic in prod
├─ requirements.txt  .env.example  pyproject.toml
```

Imports are flat too: `from core.repository import BaseRepository`,
`from user.service import UserService`, `from invoice.urls import router`.

## Layer responsibilities (one direction of dependency)

```
urls.py → views.py → service.py → repository.py → models.py
                 ↘ schemas.py (I/O only)      ↗
   permissions / validators / exceptions / constants / utils are cross-cut
```

| Layer | Does | Never does |
| --- | --- | --- |
| **models** | ORM tables + relationships | business logic |
| **schemas** | request/response shape + field validation | DB access, business rules |
| **repository** | the ONLY place that touches the ORM/session | commits, HTTP, business rules |
| **service** | business logic, owns the transaction (commit) | build HTTP responses, raw SQL |
| **views** | parse → call ONE service method → wrap envelope | business logic, ORM |
| **urls** | map paths → views; declare RBAC per route | logic |
| **permissions** | authN/Z (`require_roles`, ownership) | data mutation |
| **validators** | reusable cross-field/policy validation | DB access |
| **exceptions** | domain error types (extend `AppException`) | — |
| **tasks** | Celery background jobs (own their session) | reuse request session |

## SOLID & patterns
- **SRP**: every file has one reason to change (the table above).
- **DIP**: views depend on services, services on repositories — not on the
  session or framework. `BaseRepository`/`BaseService` are the abstractions.
- **OCP**: add an app = add a folder + append its router to `APP_ROUTERS`; no
  edits to existing apps.
- **Repository pattern**: all ORM access funnels through typed repositories.
- **Type hints everywhere**; generics on `BaseRepository[Model]`.

## API conventions
- **Consistent envelope** — success: `{success, message, data, meta?}`,
  error: `{success:false, message, code, errors}`. Built by `core/responses.py`
  and `core/exception_handlers.py`; views never hand-build errors.
- **Auth**: JWT access/refresh (`POST /api/v1/users/login`, `/refresh`).
- **RBAC**: `require_roles("admin")` as a route dependency (URL layer) +
  ownership checks in the service/permissions layer.
- **Pagination**: `?page=&size=` → `meta {page,size,total,total_pages}`.
- **Filtering / search / ordering**: query params pushed down to SQL
  (`?status=&search=&sort=-total_amount`); sort keys are whitelisted.

## ORM rules (how N+1 is structurally impossible here)
1. **`lazy="raise"` on relationships** (`invoice/models.py`): touching an
   un-loaded relationship RAISES — accidental N+1 fails loudly in dev.
2. **Eager-load in the repository, once**: `joinedload` (to-one, ≈ `select_related`)
   and `selectinload` (to-many, ≈ `prefetch_related`) are chosen by the repo
   (`_list_options` / `_detail_options`) — never lazy access in a serializer.
3. **No ORM in loops**: writes use `add_items()` (one bulk INSERT) and
   `bulk_update_by_ids()` (one UPDATE … WHERE IN); reads use `index_by`/`group_by`
   in `core/utils.py` to join in memory.
4. **No serializer-triggered queries**: schemas use `from_attributes` over data
   the repository already loaded.
5. **Aggregations in one query**: `status_breakdown()` is a single GROUP BY
   (`func.count`, `func.sum`) — no per-row counting.
6. **Denormalize hot totals**: `Invoice.total_amount` is stored at write time so
   list endpoints never re-sum line items per row.
7. **Count once for pagination**: `repository.count(*where)` mirrors the list
   `where` — no full-table scans, no fetching rows to count them.
8. **Whitelisted ORDER BY**: `validators.normalize_sort` blocks arbitrary sort
   columns (correctness + safety).

## Coding standards
- One service call per view; views stay < ~15 lines.
- Repositories return ORM objects or scalars; services return ORM objects or
  small DTOs/schemas; views return the envelope.
- No bare `except`; raise typed `AppException` subclasses.
- Decimal for money; UTC timestamps; UUID PKs.
- Constants/enums over magic strings (`StrEnum`).
- Tests: pure layers (validators/security/services) unit-tested without a DB;
  repository/endpoint integration tests use a throwaway DB.

## Run
```bash
python -m venv .venv && . .venv/bin/activate     # (Windows: .venv\Scripts\activate)
pip install -r requirements.txt
cp .env.example .env                              # set DATABASE_URL / SECRET_KEY
python -m scripts.create_tables                   # dev only; use Alembic in prod
uvicorn main:app --reload                         # API
celery -A core.celery_app.celery_app worker -l info       # background worker
pytest                                            # tests
```

## Add a new app (e.g. `payment`)
1. Create a top-level `payment/` package with the same files (`models, schemas,
   repository, service, views, urls, permissions, validators, exceptions, tasks,
   constants, utils` + `tests/`).
2. Add `from payment.urls import router as payment_router` and append it to
   `APP_ROUTERS` in `main.py`. Add `"payment"` to `autodiscover_tasks([...])` in
   `core/celery_app.py`. Nothing else changes.
