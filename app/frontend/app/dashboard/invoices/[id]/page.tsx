"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, type InvoiceDetail } from "../../../../lib/api-client";
import { getToken } from "../../../../lib/token";
import { useRouter } from "next/navigation";
import { Banner, Card, Field, FieldGrid, PageHeader, StatusDot, Tabs } from "../../../../components/ui";

type TabId = "overview" | "parties" | "lines" | "submissions" | "qr" | "xml" | "error";

interface InvoiceLineJson {
  id: string;
  name: string;
  quantity: string;
  unit_code?: string;
  unit_price?: string;
  line_extension?: string;
  tax_amount?: string;
  tax_category?: string;
  tax_percent?: string;
  discount_amount?: string;
  discount_reason?: string | null;
}

interface PartyJson {
  registration_name: string;
  vat_number?: string | null;
  crn?: string | null;
  street?: string;
  building_number?: string;
  city_subdivision?: string;
  city?: string;
  postal_zone?: string;
  country_code?: string;
}

interface TaxSubtotalJson {
  taxable_amount: string;
  tax_amount: string;
  tax_category: string;
  tax_percent: string;
  exemption_reason_code?: string | null;
  exemption_reason?: string | null;
}

interface MonetaryTotalsJson {
  line_extension: string;
  tax_exclusive: string;
  tax_inclusive: string;
  allowance_total?: string;
  charge_total?: string;
  prepaid_amount?: string;
  payable_amount: string;
}

export default function InvoiceDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [inv, setInv] = useState<InvoiceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("overview");
  const [amendOpen, setAmendOpen] = useState(false);

  useEffect(() => {
    const token = getToken();
    if (!token || !params.id) return;
    api.getInvoice(token, params.id).then(setInv).catch((e) => setError(String(e)));
  }, [params.id]);

  if (error) {
    return (
      <div>
        <BackLink />
        <Banner tone="danger">{error}</Banner>
      </div>
    );
  }
  if (!inv) return <div><BackLink /><p className="muted">Loading…</p></div>;

  const p = inv.payload_json as unknown as {
    supplier?: PartyJson;
    customer?: PartyJson;
    lines?: InvoiceLineJson[];
    tax_subtotals?: TaxSubtotalJson[];
    monetary_totals?: MonetaryTotalsJson;
    payment_means_code?: string;
    billing_reference_id?: string | null;
    instruction_note?: string | null;
    issue_date?: string;
    issue_time?: string;
    invoice_number?: string;
    currency?: string;
  };

  const lines = p.lines ?? [];
  const totals = p.monetary_totals;
  const subs = p.tax_subtotals ?? [];
  const hasError = !!inv.last_error || inv.status === "rejected" || inv.status.startsWith("failed");

  return (
    <div>
      <BackLink />

      <PageHeader
        title={
          <span className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-[var(--color-fg-2)]">{p.invoice_number || `ICV ${inv.icv}`}</span>
            <span className={`badge ${
              inv.status === "cleared" || inv.status === "reported" ? "badge-success" :
              inv.status === "rejected" || inv.status.startsWith("failed") ? "badge-danger" :
              inv.status === "queued" || inv.status === "retrying" ? "badge-warning" : "badge-neutral"
            }`}>
              <StatusDot status={inv.status} />
              {inv.status}
            </span>
            <span className="badge badge-neutral">{inv.env}</span>
          </span>
        }
        description={<span>{inv.doc_type} · ICV <span className="font-mono">{inv.icv}</span></span>}
        actions={
          (inv.status === "cleared" || inv.status === "reported") &&
          !inv.doc_type.includes("_note") ? (
            <button className="btn btn-primary" onClick={() => setAmendOpen(true)}>
              Amend (issue credit / debit note)
            </button>
          ) : null
        }
      />

      <Tabs<TabId>
        value={tab}
        onChange={setTab}
        items={[
          { id: "overview",    label: "Overview" },
          { id: "parties",     label: "Parties" },
          { id: "lines",       label: "Line items",   count: lines.length },
          { id: "submissions", label: "Submissions",  count: inv.submissions.length },
          { id: "qr",          label: "QR",           disabled: !inv.qr_base64 },
          { id: "xml",         label: "XML" },
          { id: "error",       label: "Error",        disabled: !hasError },
        ]}
      />

      {tab === "overview" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card title="Document" className="lg:col-span-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <Row label="Invoice number" value={p.invoice_number} mono />
              <Row label="Doc type"  value={inv.doc_type} />
              <Row label="Subtype"   value={inv.subtype} />
              <Row label="ICV"       value={inv.icv} mono />
              <Row label="UUID"      value={inv.uuid} mono />
              <Row label="Env"       value={inv.env} />
              <Row label="Issue date / time" value={`${p.issue_date ?? "—"} ${p.issue_time ?? ""}`.trim()} />
              <Row label="Currency"  value={p.currency ?? "SAR"} />
              <Row label="Payment method" value={p.payment_means_code} />
              {p.billing_reference_id && <Row label="References" value={p.billing_reference_id} />}
              <Row label="Created"   value={new Date(inv.created_at).toLocaleString()} />
              <Row label="Signed"    value={inv.signed_at && new Date(inv.signed_at).toLocaleString()} />
              <Row label="Submitted" value={inv.submitted_at && new Date(inv.submitted_at).toLocaleString()} />
            </div>
          </Card>

          <Card title="Totals">
            {totals ? (
              <div className="flex flex-col gap-1.5 text-sm">
                <TotalRow label="Line extension" value={totals.line_extension} />
                {totals.allowance_total && Number(totals.allowance_total) > 0 && (
                  <TotalRow label="Allowance total"  value={`− ${totals.allowance_total}`} />
                )}
                {totals.charge_total && Number(totals.charge_total) > 0 && (
                  <TotalRow label="Charge total"     value={`+ ${totals.charge_total}`} />
                )}
                <TotalRow label="Tax exclusive" value={totals.tax_exclusive} />
                <TotalRow label="VAT total"     value={(Number(totals.tax_inclusive) - Number(totals.tax_exclusive)).toFixed(2)} />
                <div className="border-t border-[var(--color-border)] pt-2 mt-1">
                  <TotalRow label="Payable" value={totals.payable_amount} bold />
                </div>
              </div>
            ) : <p className="muted">No totals.</p>}
          </Card>

          <Card title="Invoice hash" className="lg:col-span-3">
            <code className="text-xs break-all text-[var(--color-fg-2)] font-mono">
              {inv.invoice_hash ?? "—"}
            </code>
          </Card>
        </div>
      )}

      {tab === "parties" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card title="Supplier (seller)">
            <PartyBlock party={p.supplier} />
          </Card>
          <Card title="Customer (buyer)">
            <PartyBlock party={p.customer} />
          </Card>
        </div>
      )}

      {tab === "lines" && (
        <div className="flex flex-col gap-4">
          <Card>
            {lines.length === 0 ? <p className="muted">No line items.</p> : (
              <table className="responsive-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Name</th>
                    <th className="text-right">Qty</th>
                    <th>Unit</th>
                    <th className="text-right">Unit price</th>
                    <th className="text-right">Discount</th>
                    <th>VAT</th>
                    <th className="text-right">Line ext.</th>
                    <th className="text-right">VAT</th>
                    <th className="text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => {
                    const ext  = Number(l.line_extension ?? 0);
                    const tax  = Number(l.tax_amount ?? 0);
                    const total = ext + tax;
                    return (
                      <tr key={l.id} className="hover:bg-[var(--color-bg-hover)]">
                        <td data-label="#" className="font-mono">{l.id}</td>
                        <td data-label="Name" className="font-medium">{l.name}</td>
                        <td data-label="Qty"        className="md:text-right tabular-nums">{l.quantity}</td>
                        <td data-label="Unit">{l.unit_code ?? "PCE"}</td>
                        <td data-label="Unit price" className="md:text-right tabular-nums">{l.unit_price ?? "—"}</td>
                        <td data-label="Discount"   className="md:text-right tabular-nums">{l.discount_amount ?? "0"}</td>
                        <td data-label="VAT">
                          <span className="badge badge-neutral">{l.tax_category ?? "S"} · {l.tax_percent ?? "15"}%</span>
                        </td>
                        <td data-label="Line ext." className="md:text-right tabular-nums">{ext.toFixed(2)}</td>
                        <td data-label="VAT"       className="md:text-right tabular-nums">{tax.toFixed(2)}</td>
                        <td data-label="Total"     className="md:text-right tabular-nums font-medium">{total.toFixed(2)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Card>

          {subs.length > 0 && (
            <Card title="VAT subtotals" description="One row per (tax category, percent).">
              <table className="responsive-table">
                <thead>
                  <tr>
                    <th>Category</th>
                    <th className="text-right">%</th>
                    <th className="text-right">Taxable</th>
                    <th className="text-right">VAT</th>
                    <th>Exemption code</th>
                  </tr>
                </thead>
                <tbody>
                  {subs.map((s, i) => (
                    <tr key={i}>
                      <td data-label="Category">{s.tax_category}</td>
                      <td data-label="%"        className="md:text-right tabular-nums">{s.tax_percent}</td>
                      <td data-label="Taxable"  className="md:text-right tabular-nums">{s.taxable_amount}</td>
                      <td data-label="VAT"      className="md:text-right tabular-nums">{s.tax_amount}</td>
                      <td data-label="Exemption" className="text-[var(--color-fg-muted)] text-xs">{s.exemption_reason_code ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </div>
      )}

      {tab === "submissions" && (
        <Card title="Submission history" description="Every call attempt to ZATCA for this invoice.">
          {inv.submissions.length === 0 ? (
            <p className="muted">No submissions recorded (this invoice was seeded locally or hasn&apos;t been sent yet).</p>
          ) : (
            <table className="responsive-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Kind</th>
                  <th>HTTP</th>
                  <th>ZATCA status</th>
                  <th>Submitted</th>
                </tr>
              </thead>
              <tbody>
                {inv.submissions.map((s) => (
                  <tr key={s.id}>
                    <td data-label="#" className="font-mono">{s.attempt}</td>
                    <td data-label="Kind">{s.kind}</td>
                    <td data-label="HTTP" className="font-mono">{s.http_status ?? "—"}</td>
                    <td data-label="ZATCA">{s.zatca_status ?? "—"}</td>
                    <td data-label="Submitted" className="text-[var(--color-fg-muted)]">
                      {s.submitted_at ? new Date(s.submitted_at).toLocaleString() : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {tab === "qr" && inv.qr_base64 && (
        <Card title="QR code (TLV, base64-encoded)" description="Scannable by ZATCA-compliant verifiers.">
          <div className="font-mono text-[11px] break-all text-[var(--color-fg-2)] bg-[var(--color-bg-muted)] p-3 rounded-md border border-[var(--color-border)]">
            {inv.qr_base64}
          </div>
        </Card>
      )}

      {tab === "xml" && (
        <div className="flex flex-col gap-4">
          {inv.signed_xml && (
            <Card title="Signed UBL XML" actions={
              <button className="btn btn-default !py-1 !px-2 text-xs" onClick={() => downloadText(`${p.invoice_number ?? inv.icv}.signed.xml`, inv.signed_xml!)}>
                Download
              </button>
            }>
              <pre className="text-[11px] font-mono whitespace-pre-wrap break-all max-h-[60vh] overflow-auto bg-[var(--color-bg-muted)] p-3 rounded-md border border-[var(--color-border)]">
                {inv.signed_xml}
              </pre>
            </Card>
          )}
          {inv.cleared_xml && (
            <Card title="Cleared XML (returned by ZATCA)" actions={
              <button className="btn btn-default !py-1 !px-2 text-xs" onClick={() => downloadText(`${p.invoice_number ?? inv.icv}.cleared.xml`, inv.cleared_xml!)}>
                Download
              </button>
            }>
              <pre className="text-[11px] font-mono whitespace-pre-wrap break-all max-h-[60vh] overflow-auto bg-[var(--color-bg-muted)] p-3 rounded-md border border-[var(--color-border)]">
                {inv.cleared_xml}
              </pre>
            </Card>
          )}
          {!inv.signed_xml && !inv.cleared_xml && <p className="muted">No XML available.</p>}
        </div>
      )}

      {tab === "error" && hasError && (
        <Card title="Last error">
          <pre className="whitespace-pre-wrap text-xs text-[var(--color-fg-2)] bg-[var(--color-bg-muted)] border border-[var(--color-border)] rounded-md p-3">
            {inv.last_error ?? "(no message)"}
          </pre>
        </Card>
      )}

      {amendOpen && (
        <AmendDialog
          invoice={inv}
          onClose={() => setAmendOpen(false)}
          onSubmitted={(noteId) => {
            setAmendOpen(false);
            router.push(`/dashboard/invoices/${noteId}`);
          }}
        />
      )}
    </div>
  );
}

function AmendDialog({
  invoice, onClose, onSubmitted,
}: {
  invoice: InvoiceDetail;
  onClose: () => void;
  onSubmitted: (newId: string) => void;
}) {
  const totals = (invoice.payload_json as unknown as { monetary_totals?: { payable_amount?: string } })
    .monetary_totals;
  const previous = totals?.payable_amount ?? "0";

  const [newPayable, setNewPayable] = useState(previous);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const prev = Number(previous);
  const next = Number(newPayable || 0);
  const delta = next - prev;
  const noteKind = delta < 0 ? "Credit Note" : delta > 0 ? "Debit Note" : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (delta === 0) {
      setError("Enter a new payable amount that differs from the previous one.");
      return;
    }
    if (reason.trim().length < 3) {
      setError("A reason of at least 3 characters is required for ZATCA auditability.");
      return;
    }
    const token = getToken();
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.amendInvoice(token, invoice.id, { new_payable: newPayable, reason });
      onSubmitted(res.note_invoice_id);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 bg-black/30 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white border border-[var(--color-border)] rounded-lg shadow-lg w-full max-w-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-[var(--color-border)]">
          <div className="text-sm font-semibold text-[var(--color-fg)]">
            Amend invoice {(invoice.payload_json as { invoice_number?: string }).invoice_number ?? `ICV ${invoice.icv}`}
          </div>
          <div className="text-xs text-[var(--color-fg-muted)] mt-0.5">
            ZATCA doesn&apos;t allow editing an issued invoice. We&apos;ll auto-create a
            Credit Note (reduction) or Debit Note (increase) for the delta, referencing this one.
          </div>
        </div>

        <form onSubmit={submit} className="p-5 flex flex-col gap-4">
          <FieldGrid cols={2}>
            <Field label="Previous payable (SAR)">
              <input className="input tabular-nums" value={previous} readOnly />
            </Field>
            <Field label="New payable (SAR)" required>
              <input
                className="input tabular-nums"
                inputMode="decimal"
                value={newPayable}
                onChange={(e) => setNewPayable(e.target.value)}
              />
            </Field>
          </FieldGrid>

          <div className={`text-sm rounded-md px-3 py-2 border ${
            noteKind === "Credit Note"
              ? "bg-[var(--color-success-soft)] text-[var(--color-success)] border-[var(--color-success)]/30"
              : noteKind === "Debit Note"
              ? "bg-[var(--color-warning-soft)] text-[var(--color-warning)] border-[var(--color-warning)]/30"
              : "bg-[var(--color-bg-soft)] text-[var(--color-fg-muted)] border-[var(--color-border)]"
          }`}>
            {noteKind === null ? (
              <span>Enter a different amount to preview the note.</span>
            ) : (
              <span>
                Will create a <strong>{noteKind}</strong> for{" "}
                <span className="tabular-nums">{Math.abs(delta).toFixed(2)} SAR</span>
                {" "} (delta from {prev.toFixed(2)} → {next.toFixed(2)}).
              </span>
            )}
          </div>

          <Field label="Reason" required hint="Surfaced on the note as InstructionNote. Min 3 chars.">
            <textarea
              className="input min-h-[80px]"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Returned 2 units, refund issued"
              required
              minLength={3}
            />
          </Field>

          {error && <Banner tone="danger">{error}</Banner>}

          <div className="flex justify-end gap-2">
            <button type="button" className="btn btn-default" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={busy || delta === 0}>
              {busy ? "Generating…" : noteKind === "Credit Note" ? "Issue credit note" : "Issue debit note"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/dashboard/invoices"
      className="inline-flex items-center gap-1.5 text-sm text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] mb-3"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="15 18 9 12 15 6" />
      </svg>
      Back to invoices
    </Link>
  );
}

function Row({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--color-fg-muted)]">{label}</span>
      <span className={`text-[var(--color-fg)] ${mono ? "font-mono text-xs break-all" : ""}`}>
        {value || "—"}
      </span>
    </div>
  );
}

function TotalRow({ label, value, bold }: { label: string; value: React.ReactNode; bold?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${bold ? "font-semibold text-[var(--color-fg)]" : ""}`}>
      <span className="text-[var(--color-fg-muted)]">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function PartyBlock({ party }: { party: PartyJson | undefined }) {
  if (!party || !party.registration_name) return <p className="muted">No party data.</p>;
  const addr = [party.building_number, party.street, party.city_subdivision, party.city, party.postal_zone, party.country_code]
    .filter(Boolean).join(", ");
  return (
    <div className="text-sm flex flex-col gap-2">
      <div className="font-semibold text-[var(--color-fg)]">{party.registration_name}</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {party.vat_number && <Row label="VAT"  value={party.vat_number} mono />}
        {party.crn        && <Row label="CRN"  value={party.crn} />}
      </div>
      <Row label="Address" value={addr} />
    </div>
  );
}

function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: "application/xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
