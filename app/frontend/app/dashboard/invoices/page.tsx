"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  type AmendResult,
  type InvoiceEvent,
  type InvoiceListItem,
  type InvoiceListPage,
} from "../../../lib/api-client";
import { getToken } from "../../../lib/token";
import { useActiveEnv } from "../../../lib/active-env";
import { usePreferences } from "../../../lib/preferences";
import { useInvoiceEvents } from "../../../lib/use-invoice-events";
import { pushNotification } from "../../../lib/notifications";
import { Banner, Card, Empty, Field, FieldGrid, PageHeader, StatusDot } from "../../../components/ui";

type StatusOption = "queued" | "retrying" | "cleared" | "reported" | "rejected" | "failed_pending_review";

const STATUS_OPTIONS: ReadonlyArray<{ value: StatusOption; label: string }> = [
  { value: "queued",                 label: "Queued"   },
  { value: "retrying",               label: "Retrying" },
  { value: "cleared",                label: "Cleared"  },
  { value: "reported",               label: "Reported" },
  { value: "rejected",               label: "Rejected" },
  { value: "failed_pending_review",  label: "Failed"   },
];

export default function InvoicesPage() {
  const [env] = useActiveEnv();
  const [prefs] = usePreferences();
  const pageSize = prefs.pageSize;

  const [statuses, setStatuses] = useState<StatusOption[]>([]);
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<InvoiceListPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pulse, setPulse] = useState<Set<string>>(new Set());
  const [seeding, setSeeding] = useState(false);
  const [loading, setLoading] = useState(true);
  const [amendOf, setAmendOf] = useState<InvoiceListItem | null>(null);

  const reload = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    setLoading(true);
    try {
      setData(await api.listInvoices(token, {
        page, page_size: pageSize, statuses,
        date_from: dateFrom || undefined,
        date_to:   dateTo   || undefined,
      }));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, statuses, dateFrom, dateTo]);

  useEffect(() => { reload(); }, [reload]);

  useInvoiceEvents((event: InvoiceEvent) => {
    setPulse((s) => new Set(s).add(event.invoice_id));
    setTimeout(() => setPulse((s) => { const n = new Set(s); n.delete(event.invoice_id); return n; }), 1500);
    if (page === 1) reload();
  });

  async function seedDemo() {
    const token = getToken();
    if (!token) return;
    setSeeding(true);
    setError(null);
    try {
      const res = await api.seedDemoInvoices(token, env, "1100");
      setPage(1);
      await reload();
      pushNotification({
        tone: "success",
        title: "Demo invoices created",
        body: `${res.created} invoices${res.used_dev_csid ? " (signed with a generated dev cert)" : ""}.`,
      });
    } catch (e) {
      setError(String(e));
    } finally {
      setSeeding(false);
    }
  }

  async function processQueue() {
    const token = getToken();
    if (!token) return;
    setError(null);
    try {
      const res = await api.processQueue(token);
      pushNotification({
        tone: res.released > 0 ? "success" : "info",
        title: res.released > 0 ? `Released ${res.released} from queue` : "Queue is empty",
        body: res.released > 0
          ? `${res.remaining_queued} still waiting · throttle ${res.throttle_per_minute}/min`
          : "No queued invoices to release.",
      });
      reload();
    } catch (e) {
      setError(String(e));
    }
  }

  function changeStatusFilter(s: StatusOption, on: boolean) {
    setPage(1);
    setStatuses((prev) => on ? [...prev, s] : prev.filter((x) => x !== s));
  }
  function resetFilters() {
    setStatuses([]); setDateFrom(""); setDateTo(""); setPage(1);
  }

  const items: InvoiceListItem[] = data?.items ?? [];
  const totalPages = data?.total_pages ?? 1;
  const total = data?.total ?? 0;
  const hasFilters = statuses.length > 0 || !!dateFrom || !!dateTo;

  return (
    <div>
      <PageHeader
        title={<span>Invoices <span className="text-xs font-normal text-[var(--color-fg-muted)]">(live)</span></span>}
        description={`${total.toLocaleString()} invoices${hasFilters ? " match the current filter" : " in this tenant"}.`}
        actions={
          <div className="flex gap-2 flex-wrap">
            <button type="button" onClick={processQueue} className="btn btn-default"
              title="Release pending 'queued' invoices to ZATCA up to the tenant's per-minute throttle.">
              Process queue
            </button>
            <button type="button" onClick={seedDemo} disabled={seeding} className="btn btn-default"
              title="Insert one invoice of every type. Locally signed, never submitted to ZATCA.">
              {seeding ? "Seeding…" : "Seed demo"}
            </button>
            <Link href="/dashboard/invoices/batch" className="btn btn-default">Batch</Link>
            <Link href="/dashboard/invoices/new"   className="btn btn-primary">+ New invoice</Link>
          </div>
        }
      />

      {error && <div className="mb-4"><Banner tone="danger">{error}</Banner></div>}

      <Card className="mb-4">
        <FieldGrid cols={3}>
          <Field label="Status" hint="Tick any combination — leave empty for all.">
            <StatusMultiSelect values={statuses} onChange={changeStatusFilter} />
          </Field>
          <Field label="Created from">
            <input type="date" className="input" value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} />
          </Field>
          <Field label="Created to">
            <input type="date" className="input" value={dateTo}
              onChange={(e) => { setDateTo(e.target.value); setPage(1); }} />
          </Field>
        </FieldGrid>
        {hasFilters && (
          <div className="mt-3">
            <button className="btn btn-ghost text-xs" onClick={resetFilters}>Reset filters</button>
          </div>
        )}
      </Card>

      {loading && !data ? (
        <p className="muted">Loading…</p>
      ) : items.length === 0 ? (
        <Empty
          title={hasFilters ? "No matches" : "No invoices yet"}
          description={hasFilters ? "Try widening the filter." : "Issue your first invoice to get started."}
          action={!hasFilters && (
            <div className="flex gap-2 justify-center flex-wrap">
              <Link href="/dashboard/invoices/new" className="btn btn-primary">+ New invoice</Link>
              <button onClick={seedDemo} disabled={seeding} className="btn btn-default">
                {seeding ? "Seeding…" : "Seed demo invoices"}
              </button>
            </div>
          )}
        />
      ) : (
        <>
          <Card>
            <table className="responsive-table">
              <thead>
                <tr>
                  <th>ICV</th>
                  <th>Invoice #</th>
                  <th>Customer</th>
                  <th>Type</th>
                  <th>Issue date</th>
                  <th>Status</th>
                  <th className="text-right">Total</th>
                  <th className="text-right"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id}
                    className={`hover:bg-[var(--color-bg-hover)] transition-colors ${pulse.has(r.id) ? "bg-[var(--color-warning-soft)]" : ""}`}>
                    <td data-label="ICV" className="font-mono">{r.icv}</td>
                    <td data-label="Invoice #">{r.invoice_number ?? `—`}</td>
                    <td data-label="Customer" className="text-[var(--color-fg-2)]">{r.customer_name ?? "—"}</td>
                    <td data-label="Type" className="text-[var(--color-fg-muted)]">{r.doc_type}</td>
                    <td data-label="Issue date" className="text-[var(--color-fg-muted)]">{r.issue_date ?? "—"}</td>
                    <td data-label="Status">
                      <span className="inline-flex items-center gap-2">
                        <StatusDot status={r.status} />
                        <span className="text-[var(--color-fg-2)]">{r.status}</span>
                      </span>
                    </td>
                    <td data-label="Total" className="md:text-right tabular-nums">{r.payable_amount ?? "—"}</td>
                    <td data-label="Actions" className="md:text-right">
                      <div className="flex gap-2 md:justify-end">
                        <Link href={`/dashboard/invoices/${r.id}`}
                          className="btn btn-default !py-1 !px-2 text-xs">
                          Open
                        </Link>
                        {(r.status === "cleared" || r.status === "reported") && !r.doc_type.includes("_note") && (
                          <button onClick={() => setAmendOf(r)}
                            className="btn btn-default !py-1 !px-2 text-xs"
                            title="Issue a credit / debit note for the delta">
                            Edit
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Pagination
            page={page} totalPages={totalPages} total={total} pageSize={pageSize}
            onChange={setPage}
          />
        </>
      )}

      {amendOf && (
        <AmendModal
          item={amendOf}
          onClose={() => setAmendOf(null)}
          onSubmitted={(res) => {
            setAmendOf(null);
            pushNotification({
              tone: "success",
              title: `${res.note_kind === "credit_note" ? "Credit note" : "Debit note"} issued`,
              body: `ICV ${res.note_icv} · references ${res.references} · ${res.delta} SAR`,
              href: `/dashboard/invoices/${res.note_invoice_id}`,
            });
            reload();
          }}
        />
      )}
    </div>
  );
}

/* Multi-select dropdown for status */
function StatusMultiSelect({
  values, onChange,
}: {
  values: StatusOption[];
  onChange: (s: StatusOption, on: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const label = values.length === 0 ? "All statuses" : `${values.length} selected`;

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((v) => !v)}
        className="input text-left flex items-center justify-between w-full">
        <span className={values.length === 0 ? "text-[var(--color-fg-faint)]" : ""}>{label}</span>
        <span className="text-[var(--color-fg-muted)]">▾</span>
      </button>
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {values.map((v) => {
            const lbl = STATUS_OPTIONS.find((o) => o.value === v)?.label ?? v;
            return (
              <span key={v} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs bg-[var(--color-bg-soft)] text-[var(--color-fg-2)] border border-[var(--color-border)]">
                {lbl}
                <button type="button" onClick={() => onChange(v, false)} className="text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]">×</button>
              </span>
            );
          })}
        </div>
      )}
      {open && (
        <div className="absolute mt-1 z-30 bg-white border border-[var(--color-border)] rounded-md shadow-lg w-full overflow-hidden">
          {STATUS_OPTIONS.map((o) => {
            const checked = values.includes(o.value);
            return (
              <label key={o.value}
                className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-[var(--color-bg-hover)] cursor-pointer">
                <input type="checkbox" checked={checked}
                  onChange={(e) => onChange(o.value, e.target.checked)} />
                <span className="inline-flex items-center gap-1.5">
                  <StatusDot status={o.value} /> {o.label}
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* Amend modal — lifted so it works inline on the list */
function AmendModal({
  item, onClose, onSubmitted,
}: {
  item: InvoiceListItem;
  onClose: () => void;
  onSubmitted: (r: AmendResult) => void;
}) {
  const previous = item.payable_amount ?? "0";
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
    if (delta === 0) { setError("Enter a new payable amount that differs from the previous one."); return; }
    if (reason.trim().length < 3) { setError("Min 3-character reason required."); return; }
    const token = getToken();
    if (!token) return;
    setBusy(true); setError(null);
    try {
      const res = await api.amendInvoice(token, item.id, { new_payable: newPayable, reason });
      onSubmitted(res);
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-40 bg-black/30 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white border border-[var(--color-border)] rounded-lg shadow-lg w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-[var(--color-border)]">
          <div className="text-sm font-semibold text-[var(--color-fg)]">
            Edit invoice {item.invoice_number ?? `ICV ${item.icv}`}
          </div>
          <div className="text-xs text-[var(--color-fg-muted)] mt-0.5">
            Auto-generates a Credit Note (reduction) or Debit Note (increase) referencing this invoice.
          </div>
        </div>
        <form onSubmit={submit} className="p-5 flex flex-col gap-4">
          <FieldGrid cols={2}>
            <Field label="Previous payable (SAR)">
              <input className="input tabular-nums" value={previous} readOnly />
            </Field>
            <Field label="New payable (SAR)" required>
              <input className="input tabular-nums" inputMode="decimal" value={newPayable}
                onChange={(e) => setNewPayable(e.target.value)} />
            </Field>
          </FieldGrid>
          <div className={`text-sm rounded-md px-3 py-2 border ${
            noteKind === "Credit Note" ? "bg-[var(--color-success-soft)] text-[var(--color-success)] border-[var(--color-success)]/30"
            : noteKind === "Debit Note" ? "bg-[var(--color-warning-soft)] text-[var(--color-warning)] border-[var(--color-warning)]/30"
            : "bg-[var(--color-bg-soft)] text-[var(--color-fg-muted)] border-[var(--color-border)]"}`}>
            {noteKind === null
              ? "Enter a different amount to preview the note."
              : <>Will create a <strong>{noteKind}</strong> for <span className="tabular-nums">{Math.abs(delta).toFixed(2)} SAR</span> (delta from {prev.toFixed(2)} → {next.toFixed(2)}).</>}
          </div>
          <Field label="Reason" required hint="Surfaced on the note as InstructionNote.">
            <textarea className="input min-h-[80px]" value={reason}
              onChange={(e) => setReason(e.target.value)} required minLength={3}
              placeholder="e.g. Customer returned 1 unit" />
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

/* Pagination */
function Pagination({
  page, totalPages, total, pageSize, onChange,
}: {
  page: number; totalPages: number; total: number; pageSize: number;
  onChange: (p: number) => void;
}) {
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const nums: (number | "…")[] = [];
  function push(n: number) { if (!nums.includes(n) && n >= 1 && n <= totalPages) nums.push(n); }
  push(1);
  if (page - 2 > 2) nums.push("…");
  for (let p = Math.max(2, page - 1); p <= Math.min(totalPages - 1, page + 1); p++) push(p);
  if (page + 2 < totalPages - 1) nums.push("…");
  push(totalPages);

  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mt-4 text-sm">
      <div className="text-[var(--color-fg-muted)]">
        Showing <span className="tabular-nums">{from}</span>–<span className="tabular-nums">{to}</span> of <span className="tabular-nums">{total}</span>
      </div>
      <div className="flex items-center gap-1">
        <button className="btn btn-default !py-1 !px-2 text-xs disabled:opacity-50"
          disabled={page <= 1} onClick={() => onChange(page - 1)}>‹ Prev</button>
        {nums.map((n, i) =>
          n === "…" ? <span key={`e-${i}`} className="text-[var(--color-fg-muted)] px-1.5">…</span>
          : (
            <button key={n} onClick={() => onChange(n)} aria-current={n === page ? "page" : undefined}
              className={`min-w-[32px] h-8 px-2 rounded-md text-xs font-medium border tabular-nums transition-colors ${
                n === page
                  ? "bg-[var(--color-accent)] text-white border-[var(--color-accent)]"
                  : "bg-white text-[var(--color-fg-2)] border-[var(--color-border)] hover:bg-[var(--color-bg-hover)]"}`}>
              <span className={n === page ? "text-white" : ""}>{n}</span>
            </button>
          ),
        )}
        <button className="btn btn-default !py-1 !px-2 text-xs disabled:opacity-50"
          disabled={page >= totalPages} onClick={() => onChange(page + 1)}>Next ›</button>
      </div>
    </div>
  );
}
