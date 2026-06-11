# Tools, Technology & Methodology

> **Project:** ZATCA Phase 2 — Multi-Tenant E-Invoicing Platform
> A Java-free implementation of ZATCA (Saudi tax authority) Phase 2 onboarding
> and invoice clearance/reporting. It replaces the official `fatoora` Java SDK
> with native Python while reusing the SDK's static XSD/schematron assets.

**One-line stack:** FastAPI (Python 3.12) · Next.js 15 / React 19 · PostgreSQL 16 · Redis 7 · arq worker

---

## 1. Architecture at a glance

```
                 Browser (Next.js 15 / React 19, TypeScript)
                        │  REST (Authorization: Bearer JWT)
                        │  SSE  (short-lived ticket, see §6)
                        ▼
        ┌───────────────────────────────────────────────┐
        │  FastAPI  (backend/app)                         │
        │   • /api/v1/*  REST routers                     │
        │   • JWT auth + multi-tenant scoping (deps.py)   │
        │   • SSE event stream (events.py)                │
        │   • ZATCA crypto pipeline (app/zatca/*)         │
        └───────────────┬───────────────┬────────────────┘
                        │               │
            asyncpg     │               │  redis (cache / idempotency /
            (SQLAlchemy)│               │         rate-limit / pub-sub)
                        ▼               ▼
                 PostgreSQL 16      Redis 7
                        ▲               ▲
                        │               │
        ┌───────────────┴───────────────┴────────────────┐
        │  Background processing                          │
        │   • arq worker (Redis-backed job queue)         │
        │   • in-process tick scheduler (no-Redis mode)   │
        └───────────────────────┬─────────────────────────┘
                                │ httpx
                                ▼
                       ZATCA Gateway (sandbox / simulation / production)
```

Monorepo layout: `backend` (Python service) + `frontend` (Next.js app),
plus the upstream `zatca-einvoicing-sdk-Java-*` kept only for its static assets
and reference samples.

---

## 2. Backend

| Technology | Version | Role |
| --- | --- | --- |
| **Python** | 3.12+ | Language runtime |
| **FastAPI** | ≥0.115 | HTTP API framework (async) |
| **Uvicorn** (`[standard]`) | ≥0.32 | ASGI server, auto-reload in dev |
| **SQLAlchemy** (`[asyncio]`) | ≥2.0.36 | ORM, async engine |
| **asyncpg** | ≥0.30 | Async PostgreSQL driver |
| **Alembic** | ≥1.14 | DB schema migrations |
| **Pydantic** / **pydantic-settings** | ≥2.9 / ≥2.6 | Request/response models, typed config |
| **python-jose** (`[cryptography]`) | ≥3.3 | JWT encode/decode (HS256) |
| **passlib** (`[bcrypt]`) / **bcrypt** | ≥1.7.4 | Password hashing |
| **httpx** | ≥0.28 | Async HTTP client → ZATCA gateway |
| **arq** | ≥0.26 | Redis-backed async job queue (worker) |
| **redis** | ≥5.2 | Cache, idempotency, rate-limit, pub/sub |
| **limits** | ≥3.13 | Rate-limiting primitives |
| **sse-starlette** | ≥2.1 | Server-Sent Events responses |
| **python-multipart** | ≥0.0.20 | Form / file upload parsing |
| **email-validator** | ≥2.2 | Email validation |

### ZATCA e-invoicing crypto/XML (the SDK replacement)

| Technology | Role |
| --- | --- |
| **cryptography** | EC `secp256k1` keypairs, CSR generation, XAdES signing primitives |
| **lxml** | UBL 2.1 XML build + XSD validation |
| **saxonche** (Saxon/C) | XSLT for EN16931 + ZATCA schematron validation |
| **qrcode** (`[pil]`) | TLV-encoded Phase-2 QR codes |

The full ZATCA pipeline lives under [backend/app/zatca/](backend/app/zatca/):
EC keys → CSR → C14N 1.1 canonicalization → invoice hash → XAdES-B-B signing →
TLV QR → XSD/EN16931/schematron validation → REST submission.

---

## 3. Frontend

| Technology | Version | Role |
| --- | --- | --- |
| **Next.js** | ^15 | React framework (App Router) |
| **React** / **React DOM** | ^19 | UI runtime |
| **TypeScript** | ^5.6 | Typed JS |
| **Tailwind CSS** | ^4.0 (beta) | Utility-first styling (`@tailwindcss/postcss`) |
| **@tanstack/react-query** | ^5.59 | Server-state fetching/caching |
| **zod** | ^3.23 | Runtime schema validation |
| **next-auth** | ^5 (beta) | Auth scaffolding |
| **openapi-typescript** | ^7.4 | Generate API types from backend `openapi.json` (`npm run gen:api`) |
| **pnpm** | — | Package manager |

The API layer is a thin typed REST wrapper: [frontend/lib/api-client.ts](frontend/lib/api-client.ts).
Live invoice updates flow through a single SSE connection in
[frontend/components/NotificationFeed.tsx](frontend/components/NotificationFeed.tsx)
into a global notification store that pages subscribe to.

---

## 4. Data & infrastructure

- **PostgreSQL 16** — primary store, accessed async via SQLAlchemy 2.0 + asyncpg.
  Models in [backend/app/db/models/](backend/app/db/models/), migrations via Alembic.
- **Redis 7** — four distinct uses:
  1. **Cache** of expensive lookups,
  2. **Idempotency** keys for invoice submission,
  3. **Rate limiting**,
  4. **Pub/sub** event bus (`tenant:{id}:events`) feeding the SSE stream.
- **Background work** — two modes:
  - **arq worker** ([workers/arq_worker.py](backend/app/workers/arq_worker.py)) for Redis-backed setups,
  - **in-process tick scheduler** ([workers/inproc_tick.py](backend/app/workers/inproc_tick.py)) that drains tenant queues on a 1-minute tick for single-server / no-Redis setups (started from the FastAPI lifespan).

---

## 5. MCP integration (AI tooling)

A **Model Context Protocol** server ([backend/app/mcp_server.py](backend/app/mcp_server.py),
registered in [.mcp.json](.mcp.json)) exposes ZATCA compliance operations as
callable tools — onboarding, CSID status, and running the sandbox compliance
test matrix — so an AI agent can drive and verify ZATCA onboarding/clearance
end to end.

---

## 6. Security model & methodology

- **AuthN:** JWT (HS256) issued at login; carries `sub` (user), `tid` (tenant),
  `role`, `exp`. Created/verified in [backend/app/security.py](backend/app/security.py).
- **Multi-tenant isolation:** every authenticated request resolves a
  `CurrentUser` ([deps.py](backend/app/deps.py)); queries are scoped by
  `tenant_id` from the token so tenants can never read each other's data.
- **Password storage:** bcrypt via passlib (pre-truncated to 72 bytes).
- **CORS:** configurable allow-list + dev regex
  (`cors_allow_origins` / `cors_allow_origin_regex` in [backend/app/config.py](backend/app/config.py)) —
  any `localhost`/`127.0.0.1` port is accepted in dev; production locks to explicit origins.
- **SSE stream-ticket ticket-pattern (the secure live-updates auth):**
  `EventSource` cannot send an `Authorization` header, so instead of leaking the
  long-lived JWT into the URL (and thus access logs / history / `Referer`), the
  browser mints a **short-lived (~60 s), single-purpose ticket** over an
  authenticated `POST /api/v1/events/ticket`, then opens
  `GET /api/v1/events?ticket=...`. The ticket carries `typ:"sse"`, is rejected by
  the regular API ([deps.py](backend/app/deps.py)), and expires fast — so a
  leaked ticket is inert. The frontend reconnects by minting a fresh ticket with
  exponential backoff; the ticket endpoint is the auth canary.
- **Idempotency:** `Idempotency-Key` header + Redis prevents duplicate invoice submissions.
- **Rate limiting:** `limits` + Redis, `rate_limit_per_second` configurable.

---

## 7. Developer tooling & testing

| Area | Tool |
| --- | --- |
| Backend tests | **pytest** + **pytest-asyncio** (`asyncio_mode = auto`) |
| HTTP mocking | **respx** (mocks httpx calls to the ZATCA gateway) |
| Backend lint | **ruff** (line length 100, target py312) |
| Frontend lint | **next lint** (ESLint) |
| Type generation | **openapi-typescript** (`npm run gen:api`) |
| Dev runner | [dev.bat](dev.bat) — boots backend + frontend together |
| Local DB | [start-db.bat](start-db.bat) |
| DB seeding | [backend/app/scripts/seed.py](backend/app/scripts/seed.py) — demo tenant, users, invoices |

---

## 8. Key methodologies & patterns

- **Java-free re-implementation** — native Python crypto/XML instead of the
  `fatoora` JVM SDK, reusing only its static XSD/schematron assets.
- **Multi-tenant SaaS** — single deployment, tenant isolation enforced at the
  auth/query layer via the JWT `tid` claim.
- **Async-first** — async FastAPI + SQLAlchemy + asyncpg + httpx throughout.
- **Event-driven UI** — Redis pub/sub → SSE → single browser stream → shared
  notification store (no per-page polling, no per-page connections).
- **Queue + schedule** — invoices can submit immediately or be queued and
  released on a per-tenant schedule (interval or fixed times), drained by the
  arq worker or the in-process tick.
- **Config over hardcoding** — environment-driven settings (`pydantic-settings`)
  for DB/Redis URLs, ZATCA endpoints (sandbox/simulation/production), CORS,
  token/ticket lifetimes.
- **Defense in depth** — short-lived scoped tokens, idempotency, rate limiting,
  CORS allow-listing, typed boundaries (Pydantic on the server, Zod/TS on the client).

---

*Generated from the live source tree (`pyproject.toml`, `package.json`, and the
`backend/app` module layout). Update alongside dependency changes.*
