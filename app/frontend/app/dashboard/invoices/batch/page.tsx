"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, type BatchInvoiceResponse } from "../../../../lib/api-client";
import { getToken } from "../../../../lib/token";
import { useActiveEnv } from "../../../../lib/active-env";
import { EnvBadge } from "../../../../components/EnvSwitcher";
import { Banner, Card, Field, PageHeader } from "../../../../components/ui";

export default function BatchPage() {
  const router = useRouter();
  const [env, setEnv] = useActiveEnv();
  const [json, setJson] = useState("[]");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BatchInvoiceResponse | null>(null);

  function loadSample() { setJson(JSON.stringify(SAMPLE_BATCH, null, 2)); }
  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setJson(String(reader.result));
    reader.readAsText(f);
  }

  async function submit() {
    const token = getToken();
    if (!token) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const payloads = JSON.parse(json);
      if (!Array.isArray(payloads)) throw new Error("payloads must be a JSON array");
      setResult(await api.submitBatch(token, env, payloads));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Batch upload"
        description="Up to 200 invoices per batch. Contiguous ICVs, signed and queued in one transaction."
        actions={<EnvBadge />}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2" title="Payload" description="Array of invoice payloads. Same shape as POST /api/v1/invoices.payload.">
          <div className="flex flex-col sm:flex-row gap-2 mb-3">
            <Field label="Environment">
              <select className="input" value={env} onChange={(e) => setEnv(e.target.value as typeof env)}>
                <option value="sandbox">sandbox</option>
                <option value="simulation">simulation</option>
                <option value="production">production</option>
              </select>
            </Field>
            <Field label="JSON file">
              <input type="file" accept="application/json" onChange={onFile} className="text-sm file:btn file:btn-default file:mr-3" />
            </Field>
            <div className="sm:self-end">
              <button type="button" className="btn btn-ghost" onClick={loadSample}>Load sample</button>
            </div>
          </div>
          <textarea
            value={json}
            onChange={(e) => setJson(e.target.value)}
            className="input font-mono text-xs min-h-[360px] resize-y"
          />
        </Card>

        <div className="flex flex-col gap-4">
          <Card title="Run">
            <button className="btn btn-primary w-full" onClick={submit} disabled={busy}>
              {busy ? "Submitting…" : `Submit batch to ${env}`}
            </button>
            <button className="btn btn-default w-full mt-2" onClick={() => router.push("/dashboard/invoices")}>
              Back to list
            </button>
          </Card>

          {error && <Banner tone="danger">{error}</Banner>}
          {result && (
            <Banner tone="success">
              <div className="font-medium">Accepted {result.accepted}</div>
              <div className="text-xs mt-1 opacity-80">batch_id {result.batch_id}</div>
              <div className="text-xs mt-1">Track progress on the Invoices page — rows appear live.</div>
            </Banner>
          )}
        </div>
      </div>
    </div>
  );
}

const SAMPLE_BATCH = [
  {
    doc_type: "simplified_invoice",
    invoice_number: "INV-B-1",
    uuid: "00000000-0000-0000-0000-000000000001",
    issue_date: "2026-05-17",
    issue_time: "10:00:00",
    icv: 0,
    pih_b64: "",
    supplier: { registration_name: "Al-Rukn", vat_number: "300025187600003", crn: "1010010000",
                street: "Suleim", building_number: "0001", city_subdivision: "Naseem",
                city: "Riyadh", postal_zone: "11689", country_code: "SA" },
    customer: { registration_name: "Walk-in", street: "Walk-in", building_number: "0",
                city_subdivision: "N/A", city: "Riyadh", postal_zone: "00000", country_code: "SA" },
    lines: [{ id: "1", name: "Item A", quantity: "1.0", unit_code: "PCE",
              unit_price: "100.00", line_extension: "100.00", tax_amount: "15.00",
              rounding_amount: "115.00", tax_category: "S", tax_percent: "15",
              discount_amount: "0" }],
    tax_subtotals: [{ taxable_amount: "100.00", tax_amount: "15.00", tax_category: "S", tax_percent: "15" }],
    monetary_totals: { line_extension: "100.00", tax_exclusive: "100.00", tax_inclusive: "115.00",
                       allowance_total: "0", prepaid_amount: "0", payable_amount: "115.00" },
    payment_means_code: "10",
    notes: [],
  },
];
