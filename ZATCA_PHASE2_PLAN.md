# ZATCA Phase 2 — Multi-Tenant E-Invoicing Platform (FastAPI + Next.js + Postgres, no Java SDK)

## Context

The folder [h:/wamp64/www/zatca_update](h:/wamp64/www/zatca_update) currently holds only reference material:

- [User_Manual_Developer_Portal_Manual_Version_3.pdf](h:/wamp64/www/zatca_update/User_Manual_Developer_Portal_Manual_Version_3.pdf) — ZATCA developer portal manual (onboarding flows for sandbox / simulation / production)
- [compliance_csid.pdf](h:/wamp64/www/zatca_update/compliance_csid.pdf) — compliance CSID issuance steps
- [zatca-einvoicing-sdk-Java-238-R3.3.9/Readme/readme.pdf](h:/wamp64/www/zatca_update/zatca-einvoicing-sdk-Java-238-R3.3.9/Readme/readme.pdf) — Java SDK CLI manual (`fatoora` commands, CSR/sign/hash/QR/validate)

The Java SDK ships as a `.jar` and requires JRE 11–15. The goal here is to **replace it entirely with native Python** so the production environment needs no JVM, while staying byte-for-byte compatible with what ZATCA expects (canonical XML, EC secp256k1 signatures, TLV QR, embedded XAdES, schematron rules).

Decisions confirmed by user:

- **Multi-tenant** — each company has its own CSID, private key, certificate, and PIH chain. No shared state across tenants.
- **Project root**: [h:/wamp64/www/zatca_update/app](h:/wamp64/www/zatca_update/app) — alongside the PDFs/SDK as live reference.
- **Async submission** with [arq](https://arq-docs.helpmanual.io/) + Redis: HTTP request enqueues a job, a worker submits to ZATCA and writes status back.
- **Coverage**: every invoice type the SDK supports — simplified invoice/credit/debit (reporting), standard invoice/credit/debit (clearance), export, summary, self-billing, advance payment, nominal supply, zero-rated, exempt, out-of-scope, document-level charges.

End state: a tenant signs up, generates a CSR through the Next.js dashboard, completes ZATCA onboarding (CCSID → PCSID) without leaving the app, then posts invoice JSON to the API and gets back a signed UBL + cleared/reported status + QR.

---

## Stack

| Layer | Choice | Why |
| --- | --- | --- |
| API | FastAPI (Python 3.12) | async-native, OpenAPI for the Next.js client, fits crypto libs |
| ORM | SQLAlchemy 2.x async + Alembic | mature async story, migrations |
| DB | PostgreSQL 16 | JSONB for invoice payloads, partial indexes per tenant |
| Cache / queue | Redis 7 | arq jobs + response cache + rate limit |
| Worker | arq | minimal, async, same codebase as API |
| Crypto | `cryptography` (EC secp256k1, X.509, CSR, ECDSA-SHA256) | replaces Java's Bouncy Castle |
| XML | `lxml` + custom C14N11 helper | UBL XSD validation, XPath, canonicalization |
| XSLT (schematron) | `saxonche` (Saxon-HE Python) | Java-free XSLT 2.0/3.0 — needed for the ZATCA `.xsl` rules |
| QR | `qrcode[pil]` + custom TLV encoder | spec-mandated TLV tags 1–8 |
| Frontend | Next.js 15 (App Router, TypeScript) | server actions for onboarding, dashboard for invoices |
| Auth | NextAuth.js → JWT → FastAPI dep | tenant claim baked into token |

All XSD/XSLT/sample assets are **copied from the SDK Data folder at build time** — we use the SDK's static resources, just not its Java runtime.

---

## Project Structure

```
h:/wamp64/www/zatca_update/app/
├── backend/
│   ├── pyproject.toml
│   ├── alembic.ini
│   ├── alembic/versions/
│   ├── app/
│   │   ├── main.py                  # FastAPI app
│   │   ├── config.py                # pydantic-settings, env-driven
│   │   ├── deps.py                  # auth, db, redis, current_tenant
│   │   ├── db/
│   │   │   ├── base.py
│   │   │   ├── session.py
│   │   │   └── models/              # Tenant, Csid, Invoice, PihChain, Submission, Webhook
│   │   ├── zatca/                   # THE SDK REPLACEMENT (see Phase B)
│   │   │   ├── csr.py
│   │   │   ├── keys.py
│   │   │   ├── canonicalize.py
│   │   │   ├── hash.py
│   │   │   ├── sign.py
│   │   │   ├── qr.py
│   │   │   ├── validate.py
│   │   │   ├── ubl_builder.py
│   │   │   └── client.py            # httpx client for ZATCA REST
│   │   ├── api/v1/
│   │   │   ├── tenants.py
│   │   │   ├── onboarding.py        # CSR → CCSID → PCSID
│   │   │   ├── invoices.py          # POST → enqueue → 202
│   │   │   ├── submissions.py       # GET status, retry
│   │   │   └── webhooks.py
│   │   ├── workers/
│   │   │   └── arq_worker.py        # submit_invoice job
│   │   └── assets/                  # symlink/copy of SDK Data/Schemas + Data/Rules
│   └── tests/
│       ├── fixtures/                # copied from SDK Data/Samples
│       ├── test_csr.py
│       ├── test_hash_known_vector.py
│       ├── test_sign_known_vector.py
│       ├── test_qr_tlv.py
│       └── test_onboarding_sandbox.py
└── frontend/
    ├── package.json
    ├── next.config.ts
    ├── app/
    │   ├── (auth)/login/page.tsx
    │   ├── (dashboard)/
    │   │   ├── onboarding/page.tsx  # 4-step wizard
    │   │   ├── invoices/page.tsx
    │   │   ├── invoices/new/page.tsx
    │   │   └── invoices/[id]/page.tsx
    │   └── api/                     # NextAuth + thin proxy to FastAPI
    ├── lib/
    │   ├── api-client.ts            # generated from FastAPI OpenAPI
    │   └── zatca-types.ts
    └── components/
        ├── OnboardingWizard.tsx
        ├── InvoiceForm.tsx          # all invoice types via a discriminated union
        └── QrPreview.tsx
```

---

## Step-by-Step Plan

### Phase A — Foundations (Day 1–2)

**A1. Bootstrap monorepo**
- Create [h:/wamp64/www/zatca_update/app](h:/wamp64/www/zatca_update/app) with `backend/` + `frontend/`.
- `backend/pyproject.toml` with: `fastapi`, `uvicorn[standard]`, `sqlalchemy[asyncio]`, `asyncpg`, `alembic`, `pydantic-settings`, `python-jose[cryptography]`, `cryptography`, `lxml`, `qrcode[pil]`, `saxonche`, `httpx`, `arq`, `redis`, `pytest`, `pytest-asyncio`, `respx`.
- Frontend: `npx create-next-app@latest frontend --ts --app --tailwind`.

**A2. Copy SDK static assets into the app**
- Mirror [zatca-einvoicing-sdk-Java-238-R3.3.9/Data/Schemas](h:/wamp64/www/zatca_update/zatca-einvoicing-sdk-Java-238-R3.3.9/Data/Schemas) → `backend/app/assets/schemas/`.
- Mirror [zatca-einvoicing-sdk-Java-238-R3.3.9/Data/Rules/schematrons](h:/wamp64/www/zatca_update/zatca-einvoicing-sdk-Java-238-R3.3.9/Data/Rules/schematrons) → `backend/app/assets/schematrons/`.
- Mirror [zatca-einvoicing-sdk-Java-238-R3.3.9/Data/Samples](h:/wamp64/www/zatca_update/zatca-einvoicing-sdk-Java-238-R3.3.9/Data/Samples) → `backend/tests/fixtures/samples/`.
- These XSDs/XSLs are the same files the official SDK uses for validation; reusing them keeps us byte-equivalent.

**A3. Postgres schema (Alembic migration 0001)**

```
tenants                  (id, name, vat_number, organization_identifier, created_at)
tenant_users             (id, tenant_id, email, hashed_password, role)
csr_configs              (id, tenant_id, common_name, serial_number, org_unit, address, business_category, invoice_type, env)
csids                    (id, tenant_id, env, kind ['compliance'|'production'],
                          private_key_pem, csr_pem, certificate_pem,
                          binary_security_token, secret, request_id, issued_at, revoked_at)
invoices                 (id, tenant_id, uuid, icv BIGINT, doc_type, subtype,
                          payload_json JSONB, ubl_xml TEXT, signed_xml TEXT, hash TEXT, qr TEXT,
                          status, created_at, signed_at)
pih_chain                (id, tenant_id, env, icv BIGINT, prev_hash TEXT)
submissions              (id, invoice_id, env, kind ['reporting'|'clearance'|'compliance'],
                          request_payload JSONB, response_payload JSONB,
                          http_status INT, zatca_status TEXT, attempt INT, submitted_at)
webhooks                 (id, tenant_id, url, secret, events JSONB, enabled)
```

- `(tenant_id, icv)` unique per env on `invoices` — ICV is the strictly increasing sequence ZATCA mandates.
- `pih_chain` is the running `previousInvoiceHash` per tenant per env; one row written per accepted invoice.

**A4. Auth + tenant scoping**
- NextAuth (Credentials provider) → mints JWT containing `tenant_id`, `user_id`, `role`.
- FastAPI `Depends(current_tenant)` decodes the JWT, loads the tenant, and **every query is filtered by `tenant_id`** — no implicit cross-tenant access.

---

### Phase B — Crypto core: replace the Java SDK (Day 3–6)

This phase is the heart. Every function below corresponds to a `fatoora` command. Each gets a unit test that runs against the SDK sample files in `tests/fixtures/samples/` so we're byte-equivalent.

**B1. `app/zatca/keys.py` — EC secp256k1 key generation** (replaces `fatoora -csr` key half)
- `generate_private_key() -> ec.EllipticCurvePrivateKey` using `cryptography.hazmat.primitives.asymmetric.ec.SECP256K1()`.
- `serialize_private_key(key, pem=True/False)` — emits PEM with `-----BEGIN EC PRIVATE KEY-----` headers, or **stripped** (no headers, no newlines) to match the SDK's non-pem mode. Both forms required by ZATCA tooling.

**B2. `app/zatca/csr.py` — CSR builder** (replaces `fatoora -csr -csrConfig ...`)
- Input: `CsrConfig` (Pydantic model mirroring [csr-config-template.properties](h:/wamp64/www/zatca_update/zatca-einvoicing-sdk-Java-238-R3.3.9/Data/Input/csr-config-template.properties)):
  - `common_name`, `serial_number` (format `1-{solution}|2-{model}|3-{uuid}`), `organization_identifier` (15-digit VAT), `organization_unit_name`, `organization_name`, `country_name`, `invoice_type` (4-digit bitmask, e.g. `1100` = standard+simplified), `location_address`, `industry_business_category`.
- Build subject DN with `cryptography.x509.CertificateSigningRequestBuilder`.
- Add the four ZATCA custom extensions exactly as the SDK does:
  - `1.3.6.1.4.1.311.20.2` (template name) — `TSTZATCA-Code-Signing` for sandbox, `PRZATCAcode-signing` for production. The `env` flag picks which.
  - SAN with `directoryName` carrying `SN=...`, `UID=organization_identifier`, `title=invoice_type`, `registeredAddress=...`, `businessCategory=...`.
- Sign CSR with the EC key, output base64 (no headers) — that's what ZATCA's `/compliance` endpoint accepts.

**B3. `app/zatca/canonicalize.py` — XML C14N 1.1** (replaces SDK's canonicalizer)
- Wrap `lxml.etree.tostring(tree, method='c14n', exclusive=False, with_comments=False)`.
- Provide `canonicalize_for_invoice_hash(xml_bytes)` that strips the three XPaths the signature requires (used in B5 too):
  - `not(//ancestor-or-self::ext:UBLExtensions)`
  - `not(//ancestor-or-self::cac:Signature)`
  - `not(//ancestor-or-self::cac:AdditionalDocumentReference[cbc:ID='QR'])`
- Verified against the sample signed invoice [Simplified_Invoice.xml](h:/wamp64/www/zatca_update/zatca-einvoicing-sdk-Java-238-R3.3.9/Data/Samples/Simplified/Invoice/Simplified_Invoice.xml) lines 14–28 (DigestValue `Hss2gNFjBY5OJn/5CEVZSSNUMrSf4QlCMxwsioPN6fA=`) — our hash of the same XML must match.

**B4. `app/zatca/hash.py` — invoice hash** (replaces `fatoora -generateHash`)
- `sha256(canonicalize_for_invoice_hash(xml)).digest()` → base64.
- Test vector: the digest value from the SDK sample above is the regression assertion.

**B5. `app/zatca/sign.py` — XAdES-B-B signing** (replaces `fatoora -sign`)
- Build the `<ds:Signature>` block exactly as in the sample (lines 10–62 of [Simplified_Invoice.xml](h:/wamp64/www/zatca_update/zatca-einvoicing-sdk-Java-238-R3.3.9/Data/Samples/Simplified/Invoice/Simplified_Invoice.xml)):
  1. Compute invoice digest (B4).
  2. Compute `xades:SignedProperties` digest (canonicalize the SignedProperties element, sha256, base64-of-hex-base64 — note the double-encoding the SDK does on the SignedProperties digest only).
  3. Build `<ds:SignedInfo>`, canonicalize it, sign with ECDSA-SHA256, base64 the DER → r||s — output as raw concatenation (no DER wrapper) the way ZATCA expects.
  4. Embed certificate (header/footer/newlines stripped) into `<ds:X509Certificate>`.
  5. Fill `xades:SigningTime`, `xades:CertDigest`, `xades:IssuerSerial`.
- Inject the full UBLExtension block into the invoice. Output is the signed UBL XML.

**B6. `app/zatca/qr.py` — TLV QR** (replaces `fatoora -qr`)
- Encode TLV tags **per the ZATCA Phase 2 QR spec** (visible in our sample, lines 91–94, decoded):
  - T1 seller name (UTF-8)
  - T2 VAT number
  - T3 timestamp (ISO 8601)
  - T4 invoice total with VAT
  - T5 VAT amount
  - T6 invoice hash (base64)
  - T7 ECDSA signature (base64)
  - T8 public key (DER, base64)
  - T9 certificate signature (only present for standard, not simplified — match SDK behavior)
- Concatenate `tag||len||value`, base64-encode → render PNG via `qrcode`.
- Test vector: re-derive the QR from the sample invoice and assert byte equality with the embedded `<EmbeddedDocumentBinaryObject>` for tag `QR`.

**B7. `app/zatca/validate.py` — UBL + EN16931 + ZATCA rules** (replaces `fatoora -validate`)
- `lxml` XSD validation against `assets/schemas/UBL2.1/.../UBL-Invoice-2.1.xsd`.
- Run `saxonche` against `CEN-EN16931-UBL.xsl` and `20210819_ZATCA_E-invoice_Validation_Rules.xsl`. Collect schematron failures (level, location, message).
- Return a structured `ValidationReport` — same shape the dashboard renders.

**B8. `app/zatca/ubl_builder.py` — JSON → UBL XML**
- Pydantic discriminated union of every doc type the user listed:
  ```
  InvoicePayload = Union[
      SimplifiedInvoice, SimplifiedCreditNote, SimplifiedDebitNote,
      StandardInvoice, StandardCreditNote, StandardDebitNote,
      ExportInvoice, SummaryInvoice, SelfBillingInvoice,
      AdvancePaymentInvoice, NominalSupplyInvoice,
      ZeroRatedInvoice, ExemptInvoice, OutOfScopeInvoice,
  ]
  ```
- One builder per type, but all share line-item / tax-total / supplier / customer renderers.
- Auto-populate `<cbc:InvoiceTypeCode name="...">` (the 4-digit transaction-subtype field) based on the discriminator.
- Inject `ICV` and `PIH` `<cac:AdditionalDocumentReference>` blocks (B11).

**B9. `app/zatca/client.py` — HTTPX client for ZATCA REST**
- Base URLs (env-driven, not hardcoded — see Phase D for the exact values pulled from [User_Manual_Developer_Portal_Manual_Version_3.pdf](h:/wamp64/www/zatca_update/User_Manual_Developer_Portal_Manual_Version_3.pdf)):
  - sandbox, simulation, production.
- Endpoints we implement:
  - `POST /compliance` — CCSID issuance (Basic auth: OTP)
  - `POST /compliance/invoices` — compliance test invoice (Basic auth: CCSID)
  - `POST /production/csids` — promote CCSID → PCSID (Basic auth: CCSID + compliance_request_id body)
  - `POST /invoices/clearance/single` — standard invoices (Basic auth: PCSID, header `Clearance-Status: 1`)
  - `POST /invoices/reporting/single` — simplified invoices (Basic auth: PCSID)
  - `PATCH /production/csids` — renewal
- Common headers: `Accept-Version: V2`, `Accept-Language: en`, `Content-Type: application/json`.

---

### Phase C — Onboarding flows: Sandbox → Simulation → Production (Day 7–9)

These are the three environments [User_Manual_Developer_Portal_Manual_Version_3.pdf](h:/wamp64/www/zatca_update/User_Manual_Developer_Portal_Manual_Version_3.pdf) walks through, and the state machine is identical for each. We store `env` on every artifact so a tenant can hold all three sets of credentials at once.

**C1. Step 1 — CSR generation (per env)**
- Frontend: `OnboardingWizard.tsx` step 1 collects CSR config fields, persists to `csr_configs`.
- Backend: `POST /api/v1/onboarding/csr` → `csr.build_csr()` + `keys.generate_private_key()` → store both rows in `csids` (with `kind='compliance'`, `certificate_pem=NULL`).
- The private key never leaves the server. UI shows the CSR base64 for diagnostic only.

**C2. Step 2 — Get OTP from ZATCA Fatoora portal**
- The user logs into Fatoora portal (the manual's step), generates an OTP, and pastes it into our wizard step 2. We just take it as input.

**C3. Step 3 — Compliance CSID (CCSID)**
- `POST /api/v1/onboarding/compliance` body: `{ otp, env }`.
- Backend calls `ZATCA POST /compliance` with `{ csr: <base64> }` and `Authorization: Basic base64(otp:)`.
- Response: `{ binarySecurityToken, secret, requestID }`. Store on `csids` row.
- This is exactly the flow [compliance_csid.pdf](h:/wamp64/www/zatca_update/compliance_csid.pdf) describes.

**C4. Step 4 — Compliance checks (six mandatory test invoices)**
- ZATCA requires sending six representative invoices through `/compliance/invoices` and getting `cleared`/`reported` status before promotion is allowed:
  1. Standard Invoice
  2. Standard Credit Note
  3. Standard Debit Note
  4. Simplified Invoice
  5. Simplified Credit Note
  6. Simplified Debit Note
- Backend uses the same builders/signers from Phase B with **fixed sample payloads** (mirrored from [Data/Samples](h:/wamp64/www/zatca_update/zatca-einvoicing-sdk-Java-238-R3.3.9/Data/Samples)), submits each, stores results in `submissions`. UI shows pass/fail per invoice.
- Gate the next step until all six are green.

**C5. Step 5 — Production CSID (PCSID)**
- `POST /api/v1/onboarding/production`: backend calls `ZATCA POST /production/csids` with `{ compliance_request_id }` and Basic auth = CCSID. Response is the PCSID. Store as a new `csids` row with `kind='production'`.
- Tenant is now live for that environment.

**C6. Cert renewal & revocation handlers**
- Cron-like daily arq job checks `certificate_pem`'s `notAfter`. 30 days before expiry, it auto-runs a renewal via `PATCH /production/csids` and rotates the row. Dashboard surfaces upcoming expirations.

---

### Phase D — Invoice submission flow (Day 10–12)

**D1. `POST /api/v1/invoices`** — sync part
1. Validate payload (Pydantic) → reject 422 with field errors.
2. Resolve current `(tenant_id, env)` PCSID; reject if missing.
3. Allocate next `ICV` via `SELECT ... FOR UPDATE` on `pih_chain` (or Postgres advisory lock per tenant).
4. Fetch previous `PIH` from `pih_chain` (or the genesis hash `0` base64 for the very first invoice).
5. Build UBL → sign → hash → QR (Phase B).
6. Persist `invoices` row with `status='queued'`, full `signed_xml`, `hash`, `qr`.
7. Enqueue arq job `submit_invoice(invoice_id)`. Return `202 { id, status: 'queued' }`.

**D2. arq worker** — async part
- Pick route by doc type:
  - Simplified family → `/invoices/reporting/single`
  - Standard family → `/invoices/clearance/single`
- POST `{ invoiceHash, uuid, invoice: <base64 signed UBL> }`.
- On `2xx`:
  - For clearance, ZATCA returns a cleared XML — store that as `cleared_xml`.
  - Update `invoices.status` and write the new `pih_chain` row (this is the chain that the *next* invoice will reference).
  - Fire any tenant webhook in `webhooks`.
- On `4xx`: mark `rejected`, parse `validationResults` into the row, do not advance PIH.
- On `5xx` / timeout: exponential backoff, max 5 attempts, then `failed_pending_review`.

**D3. `GET /api/v1/invoices/{id}`** — full detail incl. validation results, QR PNG download, signed XML download.

**D4. `GET /api/v1/invoices?status=...&from=...&to=...`** — list with cursor pagination. Heavy filters (last 90 days, this tenant, status=cleared) → Postgres partial indexes.

---

### Phase E — Caching (Day 12)

Redis is used surgically — caching is not free for a tax-critical system. Cache only stable, deterministic reads:

- **`csids` by `(tenant_id, env, kind)`** — TTL 5 min, busted on rotation. Hot path for every submission.
- **Validation rule artifacts** (compiled `saxonche` XSLT object, parsed XSD) — process-local LRU, no Redis needed.
- **`GET /invoices/{id}`** — keyed by `(id, status, tenant_id)`, TTL 30s, busted on status change.
- **Idempotency keys** — clients can send `Idempotency-Key` header on `POST /invoices`; we store `(tenant_id, key) → invoice_id` in Redis for 24h to make retries safe.
- **Rate limiting** — `redis-cell`/`limits` library, per tenant, defaults to 50 req/s.

What we explicitly **do not cache**: PIH chain reads (must be fresh under lock), ZATCA responses, anything tenant cross-cutting.

---

### Phase F — Next.js dashboard (Day 13–15)

**F1. Pages**
- `/login` — credentials form.
- `/onboarding` — 5-step wizard (one step per C1–C5), env selector (sandbox / simulation / production) tabs at top.
- `/invoices` — paginated table; columns: ICV, type, customer, total, status, ZATCA timestamp, QR thumbnail.
- `/invoices/new` — dynamic form: pick doc type → form re-renders with type-specific fields (driven by the Pydantic discriminator → exported as Zod schema).
- `/invoices/[id]` — detail view: signed XML download, cleared XML download, QR PNG, validation report, retry button on failures.
- `/settings/webhooks` — register and rotate webhook secrets.

**F2. OpenAPI client**
- FastAPI emits `/openapi.json`; we run `openapi-typescript` on each backend dev start to regenerate `frontend/lib/api-client.ts` — Next.js gets fully typed responses, no drift.

---

### Phase G — Verification (Day 16)

End-to-end checks before we call it done:

1. **Unit test parity with the SDK** — for every sample under [Data/Samples](h:/wamp64/www/zatca_update/zatca-einvoicing-sdk-Java-238-R3.3.9/Data/Samples), our pipeline must produce **the same** invoice hash, the same canonical bytes, and the same TLV QR as the embedded one. Test failures here mean a crypto bug, not a tax bug.
2. **Run our `/zatca/validate.py` over `Simplified_Invoice_Error.xml` and `Standard_Invoice_Error.xml`** — they must come back with the exact validation errors the SDK reports (compare against running `fatoora -validate` once for the baseline, then the harness is Java-free forever).
3. **Sandbox onboarding** — run the full wizard against the ZATCA sandbox base URL with a throwaway tenant. All six compliance invoices must clear.
4. **Simulation environment** — repeat the wizard pointing at the simulation URL. Submit a Saturday-batch of ~50 invoices, confirm `pih_chain` advances correctly and ICVs are gap-free.
5. **Production smoke** — under one real tenant, post one simplified invoice. Verify it appears in the Fatoora merchant portal within minutes.
6. **Failure mode tests** — kill Redis mid-submit, confirm worker retries on restart; revoke a cert in DB, confirm submission fails closed.

---

## Critical files to reference / reuse

| Purpose | Path |
| --- | --- |
| CSR config example (English) | [Data/Input/csr-config-example-EN.properties](h:/wamp64/www/zatca_update/zatca-einvoicing-sdk-Java-238-R3.3.9/Data/Input/csr-config-example-EN.properties) |
| CSR config template | [Data/Input/csr-config-template.properties](h:/wamp64/www/zatca_update/zatca-einvoicing-sdk-Java-238-R3.3.9/Data/Input/csr-config-template.properties) |
| UBL XSDs (validation source) | [Data/Schemas/xsds/UBL2.1/](h:/wamp64/www/zatca_update/zatca-einvoicing-sdk-Java-238-R3.3.9/Data/Schemas/) |
| EN16931 + ZATCA schematron XSLs | [Data/Rules/schematrons/](h:/wamp64/www/zatca_update/zatca-einvoicing-sdk-Java-238-R3.3.9/Data/Rules/) |
| Reference signed simplified invoice | [Data/Samples/Simplified/Invoice/Simplified_Invoice.xml](h:/wamp64/www/zatca_update/zatca-einvoicing-sdk-Java-238-R3.3.9/Data/Samples/Simplified/Invoice/Simplified_Invoice.xml) |
| Reference signed standard invoice | [Data/Samples/Standard/Invoice/Standard_Invoice.xml](h:/wamp64/www/zatca_update/zatca-einvoicing-sdk-Java-238-R3.3.9/Data/Samples/Standard/Invoice/Standard_Invoice.xml) |
| SDK readme (CLI spec we're mirroring) | [Readme/readme.md](h:/wamp64/www/zatca_update/zatca-einvoicing-sdk-Java-238-R3.3.9/Readme/readme.md) |
| Onboarding flow doc | [User_Manual_Developer_Portal_Manual_Version_3.pdf](h:/wamp64/www/zatca_update/User_Manual_Developer_Portal_Manual_Version_3.pdf) |
| CCSID flow doc | [compliance_csid.pdf](h:/wamp64/www/zatca_update/compliance_csid.pdf) |

---

## Out of scope (explicitly, for this iteration)

- B2B XML buyer delivery (email/PEPPOL) — only the API + dashboard are in scope; ZATCA's clearance returns the cleared XML and we let the tenant fetch/forward it.
- PDF/A-3 embedding of XML — the SDK supports it ([Data/Samples/PDF-A3](h:/wamp64/www/zatca_update/zatca-einvoicing-sdk-Java-238-R3.3.9/Data/Samples/PDF-A3)) but it's a Phase 3 nice-to-have, not a ZATCA Phase 2 requirement.
- ERP push integrations (Odoo, SAP) — out of scope; this is the platform, integrations sit on top of the API.
- Arabic-first UI — interface can stay English; invoice rendering already handles `cbc:Note languageID="ar"` from the Pydantic side.
