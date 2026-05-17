# ZATCA Phase 2 — Multi-Tenant E-Invoicing Platform

Java-free implementation of ZATCA Phase 2 onboarding and invoice submission.
Replaces the official `fatoora` Java SDK with native Python while reusing its
static XSD/schematron assets.

Stack: **FastAPI (Python 3.12) · Next.js 15 · PostgreSQL 16 · Redis 7 · arq worker**.

## Quick start

```powershell
# 1. Backend
cd backend
copy .env.example .env
# edit .env with your Postgres + Redis URLs
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e ".[dev]"
alembic upgrade head
uvicorn app.main:app --reload

# 2. arq worker (separate terminal)
arq app.workers.arq_worker.WorkerSettings

# 3. Frontend
cd ..\frontend
npm install
npm run dev
```

Open http://localhost:3000.

## What's in here

| Step | What | Where |
| --- | --- | --- |
| A1 | Monorepo bootstrap | [backend/pyproject.toml](backend/pyproject.toml) · [frontend/package.json](frontend/package.json) |
| A2 | SDK static assets (XSD/schematrons) | [backend/app/assets/](backend/app/assets/) |
| A3 | Postgres schema | [backend/alembic/versions/0001_initial_schema.py](backend/alembic/versions/0001_initial_schema.py) |
| A4 | Auth + tenant scoping | [backend/app/security.py](backend/app/security.py) · [backend/app/deps.py](backend/app/deps.py) · [backend/app/api/v1/auth.py](backend/app/api/v1/auth.py) |
| B1 | EC secp256k1 keys | [backend/app/zatca/keys.py](backend/app/zatca/keys.py) |
| B2 | CSR builder | [backend/app/zatca/csr.py](backend/app/zatca/csr.py) |
| B3 | XML C14N 1.1 | [backend/app/zatca/canonicalize.py](backend/app/zatca/canonicalize.py) |
| B4 | Invoice hash | [backend/app/zatca/hash.py](backend/app/zatca/hash.py) |
| B5 | XAdES-B-B signer | [backend/app/zatca/sign.py](backend/app/zatca/sign.py) |
| B6 | TLV QR encoder | [backend/app/zatca/qr.py](backend/app/zatca/qr.py) |
| B7 | UBL XSD + EN16931 + ZATCA schematron validator | [backend/app/zatca/validate.py](backend/app/zatca/validate.py) |
| B8 | UBL XML builder | [backend/app/zatca/ubl_builder.py](backend/app/zatca/ubl_builder.py) |
| B9 | ZATCA REST client | [backend/app/zatca/client.py](backend/app/zatca/client.py) |
| C | Onboarding API | [backend/app/api/v1/onboarding.py](backend/app/api/v1/onboarding.py) |
| D | Invoice API (single + batch) + worker | [backend/app/api/v1/invoices.py](backend/app/api/v1/invoices.py) · [backend/app/workers/arq_worker.py](backend/app/workers/arq_worker.py) |
| E | Redis caching, idempotency, rate limit | [backend/app/redis_client.py](backend/app/redis_client.py) |
| F | Next.js dashboard | [frontend/app/](frontend/app/) |
| G | Verification tests | [backend/tests/](backend/tests/) |
| Live | Tenant-scoped event bus (Redis pub/sub) | [backend/app/events.py](backend/app/events.py) |
| Live | Server-Sent Events endpoint | [backend/app/api/v1/events.py](backend/app/api/v1/events.py) |
| Live | Frontend EventSource hook + notifications | [frontend/lib/use-invoice-events.ts](frontend/lib/use-invoice-events.ts) |

## How the SDK was replaced

| Java SDK command | Python module |
| --- | --- |
| `fatoora -csr` | [keys.py](backend/app/zatca/keys.py) + [csr.py](backend/app/zatca/csr.py) |
| `fatoora -generateHash` | [hash.py](backend/app/zatca/hash.py) |
| `fatoora -sign` | [sign.py](backend/app/zatca/sign.py) |
| `fatoora -qr` | [qr.py](backend/app/zatca/qr.py) |
| `fatoora -validate` | [validate.py](backend/app/zatca/validate.py) (uses `saxonche` for XSLT) |
| `fatoora -invoiceRequest` | [client.py](backend/app/zatca/client.py) |

## Onboarding flow (sandbox / simulation / production)

1. **CSR** — `POST /api/v1/onboarding/csr` with `{ env, config }`. The
   `config.invoice_type` is a 4-digit bitmask: `1100` (standard+simplified),
   `1000` (B2B only), `0100` (B2C only) are the three valid combinations.
2. **Compliance CSID** — user pastes OTP from Fatoora portal. `POST
   /api/v1/onboarding/compliance` → ZATCA `/compliance` → store CCSID bundle.
3. **Compliance demo invoices** — `POST /api/v1/onboarding/compliance-check`
   synthesizes 3 or 6 demo invoices from the tenant's CSR (matching the
   bitmask), signs and submits each to `/compliance/invoices` under the CCSID.
   Stamps `csids.compliance_passed_at` when every one returns CLEARED/REPORTED.
   The demo generator lives in [backend/app/zatca/demo.py](backend/app/zatca/demo.py).
4. **Production CSID** — `POST /api/v1/onboarding/production` gated by
   `compliance_passed_at`. Returns 412 `compliance_checks_not_passed` if step 3
   was skipped or any demo failed.
5. Now tenant can post live invoices on that env.

## Choosing the API target (sandbox vs production)

The sidebar carries a three-button **API target** switcher (Sandbox /
Simulation / Production). It persists per-browser in `localStorage` and is the
default `env` for every onboarding action, new invoice, and batch. Each page
also still has a per-action `env` dropdown that overrides the global selection
for one submission.

- **Sandbox** — ZATCA developer portal, used during first integration.
- **Simulation** — pre-prod mirror of production, for UAT.
- **Production** — live tax submissions.

Component: [frontend/components/EnvSwitcher.tsx](frontend/components/EnvSwitcher.tsx). State
helper: [frontend/lib/active-env.ts](frontend/lib/active-env.ts).

## Batch submission

`POST /api/v1/invoices/batch` — accepts up to 200 invoices in one request.
Inside a single Postgres transaction:

1. Per-(tenant, env) advisory lock.
2. Allocate contiguous ICVs starting at `max(icv)+1`.
3. For each invoice: sign + QR + persist + advance `pih_chain` (the next
   invoice in the batch references the previous one's hash).
4. Enqueue every invoice's `submit_invoice_job` on the arq queue.

The response is `202` with a `batch_id`, the count of accepted items, and the
per-item `(id, icv, invoice_hash, status)`. ZATCA submission happens
asynchronously — clients watch the live event stream (below).

## Live updates (SSE)

The worker and the API publish events to `tenant:{tenant_id}:events` on Redis.
The browser subscribes via `GET /api/v1/events?token=<jwt>` and gets:

| Event | When |
| --- | --- |
| `invoice.queued`   | Right after the row is persisted |
| `invoice.cleared`  | Worker received 2xx from `/invoices/clearance/single` |
| `invoice.reported` | Worker received 2xx from `/invoices/reporting/single` |
| `invoice.retrying` | 5xx — will be retried with backoff |
| `invoice.rejected` | 4xx — definitive ZATCA rejection |
| `invoice.failed`   | 5+ retries exhausted, or missing CSID |

All authorized users of a tenant see the same stream, so a user submitting an
invoice in one tab causes the row to appear (and animate) in every other open
tab. The frontend also fires a `Notification` for any terminal event after the
user grants permission once.

## Running tests

```powershell
cd backend
pytest
```

The hash-vector test asserts byte-equality with the SDK's embedded
`DigestValue` from
[Data/Samples/Simplified/Invoice/Simplified_Invoice.xml](../zatca-einvoicing-sdk-Java-238-R3.3.9/Data/Samples/Simplified/Invoice/Simplified_Invoice.xml).
If this passes, our canonicalization + hash pipeline is byte-equivalent to the
Java SDK.
