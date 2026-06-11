# Generated signed invoices

Generated at 2026-05-17T04:16:07.033487+00:00.
Each subfolder contains:
  - payload.json    the input JSON
  - signed.xml      the signed UBL invoice (with QR injected)
  - qr.png          scannable QR code (TLV-encoded, base64 envelope)
  - qr.b64.txt      the text inside the QR (base64 TLV)
  - meta.json       icv, uuid, invoice_hash_b64, signed_at, byte lengths

## Index

- **standard_b2b/basic** — standard_invoice — `DEMO-STD-001` — hash `FblgVLA7biMXyVIqVyVmlcm8…`
- **standard_b2b/line_discount** — standard_invoice — `DEMO-STD-002` — hash `JiALypS9uhuXu182WizbjYQo…`
- **standard_b2b/doc_discount** — standard_invoice — `DEMO-STD-003` — hash `qA3HkRQUbQXwAlKYM6s6IyX7…`
- **standard_b2b/mixed_vat** — standard_invoice — `DEMO-STD-004` — hash `IYq03q8oEoTzdcJP7ZW77erv…`
- **standard_b2b/credit_note** — standard_credit_note — `DEMO-STD-005` — hash `o+HpwRrJsudQ9N+ojoglJknB…`
- **standard_b2b/debit_note** — standard_debit_note — `DEMO-STD-006` — hash `j3EAXVgxXeorkxzV7k5THkUo…`
- **simplified_b2c/basic** — simplified_invoice — `DEMO-SIM-001` — hash `oRwNh+WyHloaNOHXnwxNuRZc…`
- **simplified_b2c/line_discount** — simplified_invoice — `DEMO-SIM-002` — hash `9oaMOLSIXDgIsaxbSJwaxPBU…`
- **simplified_b2c/multi_line_basket** — simplified_invoice — `DEMO-SIM-003` — hash `HlqqAzCxwyBEayysYVSU1E16…`
- **simplified_b2c/mixed_vat** — simplified_invoice — `DEMO-SIM-004` — hash `thICmHEFqSEA8Nc0ylSJo2Nv…`
- **simplified_b2c/credit_note** — simplified_credit_note — `DEMO-SIM-005` — hash `GQIIyUmvdmHHRz9OQenWQamw…`
- **simplified_b2c/debit_note** — simplified_debit_note — `DEMO-SIM-006` — hash `H5eWR9s0bLUZ0WV2RcOsxBiS…`
- **other_types/export_invoice** — export_invoice — `DEMO-EXPORT-001` — hash `CHXVMno38RP41H2vLCIO6Xjz…`
- **other_types/summary_invoice** — summary_invoice — `DEMO-SUMMARY-001` — hash `ra5ubiyJgsPttZENTx2C53IR…`
- **other_types/self_billing_invoice** — self_billing_invoice — `DEMO-SELFBILL-001` — hash `Skuut+bxoNiLE6/AvuHnVQw7…`
- **other_types/advance_payment_invoice** — advance_payment_invoice — `DEMO-ADVANCE-001` — hash `QUA4UKmtwF93ZYTzZi4rU7fN…`
- **other_types/nominal_supply_invoice** — nominal_supply_invoice — `DEMO-NOMINAL-001` — hash `Sz1BM6sKa2np/plPPep0uKeK…`

## Signing material

Dev self-signed cert under `_signing/`. Replace with your production CSID's cert to produce ZATCA-acceptable invoices.