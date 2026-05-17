"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api, type InvoiceDetail } from "../../../../../lib/api-client";
import { getToken } from "../../../../../lib/token";
import { pushNotification } from "../../../../../lib/notifications";
import { Banner, Card, Field, FieldGrid, PageHeader } from "../../../../../components/ui";
import { VAT_BY_CODE, VAT_CATEGORIES } from "../../../../../lib/catalog";

interface LineForm {
  id: string;
  name: string;
  quantity: string;
  unit_code: string;
  unit_price: string;
  vat_code: "S" | "Z" | "E" | "O" | "G";
  vat_percent: string;
  discount_amount: string;
}

function round2(n: number): number { return Math.round(n * 100) / 100; }

const CREDIT_REASON_PRESETS = [
  "Cancellation of the supply (full or partial)",
  "Essential change affecting VAT due",
  "Amendment of pre-agreed supply value",
  "Goods returned / services rejected",
  "Change in buyer information",
];

const DEBIT_REASON_PRESETS = [
  "Additional charge agreed after invoice",
  "Price adjustment — under-stated amount",
  "Extra goods / services delivered",
  "Late-payment or freight surcharge",
];

function computeLine(l: LineForm) {
  const qty = Number(l.quantity || 0);
  const price = Number(l.unit_price || 0);
  const disc = Number(l.discount_amount || 0);
  const percent = Number(l.vat_percent || 0);
  const lineExt = round2(qty * price - disc);
  const tax = round2((lineExt * percent) / 100);
  return { lineExt, tax };
}

export default function AmendPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [orig, setOrig] = useState<InvoiceDetail | null>(null);
  const [lines, setLines] = useState<LineForm[]>([]);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = getToken();
    if (!token || !params.id) return;
    api.getInvoice(token, params.id).then((inv) => {
      setOrig(inv);
      const p = inv.payload_json as unknown as {
        lines?: Array<{
          id?: string; name?: string;
          quantity?: string; unit_code?: string; unit_price?: string;
          tax_category?: LineForm["vat_code"]; tax_percent?: string;
          discount_amount?: string;
        }>;
      };
      const importedLines: LineForm[] = (p.lines ?? []).map((l, i) => ({
        id: String(l.id ?? i + 1),
        name: l.name ?? "",
        quantity: l.quantity ?? "1",
        unit_code: l.unit_code ?? "PCE",
        unit_price: l.unit_price ?? "0.00",
        vat_code: l.tax_category ?? "S",
        vat_percent: l.tax_percent ?? "15",
        discount_amount: l.discount_amount ?? "0",
      }));
      setLines(importedLines);
    }).catch((e) => setError(String(e)));
  }, [params.id]);

  const totals = useMemo(() => {
    const lineExt = round2(lines.reduce((s, l) => s + computeLine(l).lineExt, 0));
    const tax     = round2(lines.reduce((s, l) => s + computeLine(l).tax, 0));
    const payable = round2(lineExt + tax);
    return { lineExt, tax, payable };
  }, [lines]);

  const previousPayable = useMemo(() => {
    const totals = (orig?.payload_json as unknown as { monetary_totals?: { payable_amount?: string } } | undefined)
      ?.monetary_totals;
    return Number(totals?.payable_amount ?? "0");
  }, [orig]);

  const delta = round2(totals.payable - previousPayable);
  const noteKind = delta < 0 ? "Credit Note" : delta > 0 ? "Debit Note" : null;

  function updateLine(idx: number, patch: Partial<LineForm>) {
    setLines((prev) => prev.map((l, i) => i === idx ? { ...l, ...patch } : l));
  }
  function addLine() {
    setLines((prev) => [...prev, {
      id: String(prev.length + 1), name: "", quantity: "1", unit_code: "PCE",
      unit_price: "0.00", vat_code: "S", vat_percent: "15", discount_amount: "0",
    }]);
  }
  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!orig) return;
    if (delta === 0) {
      pushNotification({ tone: "warning", title: "No change detected",
        body: "Edit a line so the new payable differs from the previous one." });
      return;
    }
    if (reason.trim().length < 3) {
      pushNotification({ tone: "warning", title: "Reason required",
        body: "Add at least 3 characters explaining the change." });
      return;
    }
    const token = getToken();
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.amendInvoice(token, orig.id, {
        new_payable: totals.payable.toFixed(2),
        reason,
      });
      pushNotification({
        tone: "success",
        title: `${res.note_kind === "credit_note" ? "Credit note" : "Debit note"} issued`,
        body: `ICV ${res.note_icv} · references ${res.references} · ${res.delta} SAR`,
        href: `/dashboard/invoices/${res.note_invoice_id}`,
      });
      router.push(`/dashboard/invoices/${res.note_invoice_id}`);
    } catch (e) {
      pushNotification({ tone: "danger", title: "Amend failed", body: String(e) });
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!orig) return (
    <div>
      <BackLink id={params.id} />
      {error ? <Banner tone="danger">{error}</Banner> : <p className="muted">Loading…</p>}
    </div>
  );

  const p = orig.payload_json as unknown as {
    invoice_number?: string;
    supplier?: { registration_name?: string };
    customer?: { registration_name?: string; vat_number?: string };
  };

  return (
    <div>
      <BackLink id={orig.id} />

      <PageHeader
        title={<span>Edit invoice <span className="font-mono">{p.invoice_number ?? `ICV ${orig.icv}`}</span></span>}
        description="Deep-copy of the original. Modify any line — on save, ZATCA-compliant Credit / Debit Note for the delta is auto-issued, referencing the original."
      />

      <Card title="Customer (read-only)" description="To change the customer, issue a fresh invoice instead.">
        <div className="text-sm flex flex-col gap-1">
          <div className="font-medium">{p.customer?.registration_name ?? "—"}</div>
          {p.customer?.vat_number && (
            <div className="text-xs text-[var(--color-fg-muted)] font-mono">VAT {p.customer.vat_number}</div>
          )}
        </div>
      </Card>

      <Card title="Line items" className="mt-4" actions={
        <button type="button" onClick={addLine} className="btn btn-default !py-1 !px-2 text-xs">+ Add line</button>
      }>
        {lines.length === 0 ? (
          <p className="muted">No line items.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {lines.map((l, i) => {
              const c = computeLine(l);
              return (
                <div key={i} className="grid grid-cols-1 md:grid-cols-12 gap-3 p-3 bg-[var(--color-bg-muted)] rounded-md border border-[var(--color-border)]">
                  <div className="md:col-span-4">
                    <div className="label mb-1">Item</div>
                    <input className="input" placeholder="Name" value={l.name} onChange={(e) => updateLine(i, { name: e.target.value })} />
                  </div>
                  <div className="md:col-span-1">
                    <div className="label mb-1">Qty</div>
                    <input className="input tabular-nums" inputMode="decimal" value={l.quantity} onChange={(e) => updateLine(i, { quantity: e.target.value })} />
                  </div>
                  <div className="md:col-span-2">
                    <div className="label mb-1">Unit price</div>
                    <input className="input tabular-nums" inputMode="decimal" value={l.unit_price} onChange={(e) => updateLine(i, { unit_price: e.target.value })} />
                  </div>
                  <div className="md:col-span-2">
                    <div className="label mb-1">Discount</div>
                    <input className="input tabular-nums" inputMode="decimal" value={l.discount_amount} onChange={(e) => updateLine(i, { discount_amount: e.target.value })} />
                  </div>
                  <div className="md:col-span-2">
                    <div className="label mb-1">VAT</div>
                    <select
                      className="input"
                      value={l.vat_code}
                      onChange={(e) => {
                        const code = e.target.value as LineForm["vat_code"];
                        const cat = VAT_BY_CODE[code];
                        updateLine(i, { vat_code: code, vat_percent: String(cat?.defaultPercent ?? 15) });
                      }}
                    >
                      {VAT_CATEGORIES.map((v) => <option key={v.code} value={v.code}>{v.code} · {v.defaultPercent}%</option>)}
                    </select>
                  </div>
                  <div className="md:col-span-1 flex md:flex-col md:items-end md:justify-end justify-between gap-1">
                    <div className="tabular-nums text-sm font-medium text-[var(--color-fg)]">{(c.lineExt + c.tax).toFixed(2)}</div>
                    <button type="button" onClick={() => removeLine(i)} className="btn btn-ghost !p-1 !px-2 text-xs">Remove</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card title="Delta & reason" className="mt-4">
        <FieldGrid cols={3}>
          <Field label="Previous payable">
            <input className="input tabular-nums" value={previousPayable.toFixed(2)} readOnly />
          </Field>
          <Field label="New payable">
            <input className="input tabular-nums" value={totals.payable.toFixed(2)} readOnly />
          </Field>
          <Field label="Delta">
            <input className="input tabular-nums" value={delta.toFixed(2)} readOnly />
          </Field>
        </FieldGrid>

        <div className={`mt-3 text-sm rounded-md px-3 py-2 border ${
          noteKind === "Credit Note" ? "bg-[var(--color-success-soft)] text-[var(--color-success)] border-[var(--color-success)]/30"
          : noteKind === "Debit Note" ? "bg-[var(--color-warning-soft)] text-[var(--color-warning)] border-[var(--color-warning)]/30"
          : "bg-[var(--color-bg-soft)] text-[var(--color-fg-muted)] border-[var(--color-border)]"}`}>
          {noteKind === null ? (
            <span>Edit a line — when the new payable differs from the previous one, this will show whether a Credit or Debit Note is required.</span>
          ) : (
            <span>Will issue a <strong>{noteKind}</strong> for <span className="tabular-nums">{Math.abs(delta).toFixed(2)} SAR</span> referencing the original invoice.</span>
          )}
        </div>

        <div className="mt-4">
          <Field label="Reason" required hint="Required by ZATCA for auditability. Surfaced on the note as InstructionNote.">
            <div className="flex flex-wrap gap-1.5 mb-2">
              {(noteKind === "Debit Note" ? DEBIT_REASON_PRESETS : CREDIT_REASON_PRESETS).map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setReason(preset)}
                  className={`chip hover:bg-[var(--color-bg-hover)] ${reason === preset ? "border-[var(--color-accent)] text-[var(--color-accent)]" : ""}`}
                >
                  {preset}
                </button>
              ))}
            </div>
            <textarea
              className="input min-h-[80px]"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Pick a ZATCA preset above or write your own — e.g. Customer returned 2 units / Damaged on delivery"
              required minLength={3}
            />
          </Field>
        </div>
      </Card>

      <form onSubmit={submit} className="mt-4 flex justify-end gap-2">
        <Link href={`/dashboard/invoices/${orig.id}`} className="btn btn-default">Cancel</Link>
        <button type="submit" className="btn btn-primary" disabled={busy || delta === 0}>
          {busy ? "Generating…" : noteKind === "Credit Note" ? "Issue credit note" : noteKind === "Debit Note" ? "Issue debit note" : "Save"}
        </button>
      </form>
    </div>
  );
}

function BackLink({ id }: { id: string }) {
  return (
    <Link
      href={`/dashboard/invoices/${id}`}
      className="inline-flex items-center gap-1.5 text-sm text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] mb-3"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="15 18 9 12 15 6" />
      </svg>
      Back to invoice
    </Link>
  );
}
