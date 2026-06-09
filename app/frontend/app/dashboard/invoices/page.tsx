"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { invoicesApi, type InvoiceListItem } from "./_api";
import { currenciesApi } from "../settings/currencies/_api";
import { type InvoiceEvent } from "../../../lib/api/events";
import { getToken } from "../../../lib/token";
import { useActiveEnv } from "../../../lib/active-env";
import { usePreferences } from "../../../lib/preferences";
import { useInvoiceEvents } from "../../../lib/use-invoice-events";
import { pushNotification, suppressQueuedEcho } from "../../../lib/notifications";
import { trackSubmitBatch } from "../../../lib/batch-tracker";
import { useAppDispatch, useAppSelector } from "../../../lib/store";
import { invoiceSel, invoicesActions, fetchInvoices } from "./_store";
import { Card, Empty, Field, PageHeader, StatusDot } from "../../../components/ui";
import { DatePicker } from "../../../components/DatePicker";

type StatusOption = "draft" | "queued" | "retrying" | "cleared" | "reported" | "local_only" | "rejected" | "failed_pending_review";

const STATUS_OPTIONS: ReadonlyArray<{ value: StatusOption; label: string }> = [
  { value: "draft",                  label: "Draft"      },
  { value: "queued",                 label: "Queued"     },
  { value: "retrying",               label: "Retrying"   },
  { value: "cleared",                label: "Cleared"    },
  { value: "reported",               label: "Reported"   },
  { value: "local_only",             label: "Local only" },
  { value: "rejected",               label: "Rejected"   },
  { value: "failed_pending_review",  label: "Failed"     },
];

export default function InvoicesPage() {
  const [env] = useActiveEnv();
  const [prefs] = usePreferences();
  const pageSize = prefs.pageSize;

  // Draft filter state — what the user is currently typing/ticking. The
  // applied state below is what actually hits the API; commit only on Apply.
  const [draftStatuses, setDraftStatuses] = useState<StatusOption[]>([]);
  const [draftFrom, setDraftFrom]         = useState<string>("");
  const [draftTo, setDraftTo]             = useState<string>("");
  const [draftQ, setDraftQ]               = useState<string>("");
  const [statuses, setStatuses]           = useState<StatusOption[]>([]);
  const [dateFrom, setDateFrom]           = useState<string>("");
  const [dateTo, setDateTo]               = useState<string>("");
  const [q, setQ]                         = useState<string>("");

  const dispatch = useAppDispatch();
  // Invoice rows + pagination now live in the Redux store.
  const items = useAppSelector(invoiceSel.selectAll);
  const invMeta = useAppSelector((s) => s.invoices);
  const loading = invMeta.loading;

  const [page, setPageState] = useState(1);
  const [pulse, setPulse] = useState<Set<string>>(new Set());
  const [seeding, setSeeding] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [defaultCurrency, setDefaultCurrency] = useState<string>("");

  // Bulk selection of draft rows (scoped to the current page).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  // Changing page should drop the (page-scoped) selection.
  const setPage = useCallback((p: number) => {
    setSelected(new Set());
    setPageState(p);
  }, []);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    currenciesApi.listCurrencies(token)
      .then((list) => {
        const def = list.find((c) => c.is_default) ?? list[0];
        if (def) setDefaultCurrency(def.code);
      })
      .catch(() => {});
  }, []);

  const reload = useCallback(async () => {
    try {
      // Thunk sets the page items + pagination into the store on success.
      await dispatch(fetchInvoices({
        page, page_size: pageSize, statuses,
        date_from: dateFrom || undefined,
        date_to:   dateTo   || undefined,
        q:         q        || undefined,
      })).unwrap();
    } catch (e) {
      if (e !== "not_authenticated") {
        pushNotification({ tone: "danger", title: "Failed to load invoices", body: String(e) });
      }
    }
  }, [dispatch, page, pageSize, statuses, dateFrom, dateTo, q]);

  useEffect(() => { reload(); }, [reload]);

  // The bulk-submit tracker fires later (as SSE events arrive), so it needs the
  // *latest* reload, not the one captured when the batch started. Debounce so a
  // burst of terminal events triggers at most one refresh.
  const reloadRef = useRef(reload);
  useEffect(() => { reloadRef.current = reload; }, [reload]);
  const bulkReloadTimer = useRef<number | null>(null);
  const debouncedReload = useCallback(() => {
    if (bulkReloadTimer.current !== null) return;
    bulkReloadTimer.current = window.setTimeout(() => {
      bulkReloadTimer.current = null;
      reloadRef.current();
    }, 1200);
  }, []);

  function applyFilters() {
    setPage(1);
    setStatuses(draftStatuses);
    setDateFrom(draftFrom);
    setDateTo(draftTo);
    setQ(draftQ);
  }
  function resetFilters() {
    setDraftStatuses([]); setDraftFrom(""); setDraftTo(""); setDraftQ("");
    setStatuses([]);      setDateFrom("");  setDateTo("");  setQ("");
    setPage(1);
  }

  useInvoiceEvents((event: InvoiceEvent) => {
    setPulse((s) => new Set(s).add(event.invoice_id));
    setTimeout(() => setPulse((s) => { const n = new Set(s); n.delete(event.invoice_id); return n; }), 1500);
    // Instant in-place status mutation for the affected row (works on any page).
    if (event.status) dispatch(invoicesActions.patchStatus({ id: event.invoice_id, status: event.status }));
    // On page 1, also resync to pull in brand-new rows / re-sort.
    if (page === 1) reload();
  });

  async function seedDemo() {
    const token = getToken();
    if (!token) return;
    setSeeding(true);
    try {
      const res = await invoicesApi.seedDemoInvoices(token, env, "1100");
      setPage(1);
      await reload();
      pushNotification({
        tone: "success",
        title: "Demo invoices created",
        body: `${res.created} invoices${res.used_dev_csid ? " (signed with a generated dev cert)" : ""}.`,
      });
    } catch (e) {
      pushNotification({ tone: "danger", title: "Seed demo failed", body: String(e) });
    } finally {
      setSeeding(false);
    }
  }

  async function processQueue() {
    const token = getToken();
    if (!token) return;
    setProcessing(true);
    try {
      // force=true — manual click ignores schedule and drains everything.
      const res = await invoicesApi.processQueue(token, { force: true });
      pushNotification({
        tone: res.released > 0 ? "success" : "info",
        title: res.released > 0 ? `Released ${res.released} from queue` : "Queue is empty",
        body: res.released > 0
          ? `${res.remaining_queued} still waiting.`
          : "No queued invoices to release.",
      });
      reload();
    } catch (e) {
      pushNotification({ tone: "danger", title: "Process queue failed", body: String(e) });
    } finally {
      setProcessing(false);
    }
  }

  async function releaseOne(id: string) {
    const token = getToken();
    if (!token) return;
    try {
      await invoicesApi.releaseInvoice(token, id);
      // Backend emits invoice.{cleared,reported,rejected,...} via SSE. Skip
      // the local toast — let the signaler be the single source.
      reload();
    } catch (e) {
      pushNotification({ tone: "danger", title: "Release failed", body: String(e) });
    }
  }

  async function retryRejected(id: string) {
    const token = getToken();
    if (!token) return;
    try {
      await invoicesApi.retryInvoice(token, id);
      // No toast here — the backend's `submit_invoice_to_zatca` publishes an
      // invoice.rejected/reported/cleared event via the SSE signaler, which
      // NotificationFeed picks up and surfaces. Single source of truth.
      reload();
    } catch (e) {
      // Only show a toast for client-side failures the backend can't signal
      // (e.g. network error before the request reached the server).
      pushNotification({ tone: "danger", title: "Retry failed", body: String(e) });
    }
  }

  async function promoteDraft(id: string, submit_now: boolean) {
    const token = getToken();
    if (!token) return;
    try {
      await invoicesApi.promoteDraft(token, id, { submit_now });
      // Backend signals invoice.queued / .reported / .cleared via SSE. No
      // local toast — single signal source.
      reload();
    } catch (e) {
      pushNotification({ tone: "danger", title: "Promote failed", body: String(e) });
    }
  }

  function changeDraftStatus(s: StatusOption, on: boolean) {
    setDraftStatuses((prev) => on ? [...prev, s] : prev.filter((x) => x !== s));
  }

  const totalPages = invMeta.totalPages;
  const total = invMeta.total;
  const hasFilters = statuses.length > 0 || !!dateFrom || !!dateTo || !!q;

  // ---- bulk selection (draft rows on the current page) ----
  const draftIds = items.filter((r) => r.status === "draft").map((r) => r.id);
  const selectedCount = selected.size;
  const allDraftsSelected = draftIds.length > 0 && draftIds.every((id) => selected.has(id));

  function toggleOne(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id); else next.delete(id);
      return next;
    });
  }
  function toggleAllDrafts(on: boolean) {
    setSelected(on ? new Set(draftIds) : new Set());
  }

  async function bulkMoveToQueue() {
    const token = getToken();
    if (!token || selectedCount === 0) return;
    setBulkBusy(true);
    try {
      const res = await invoicesApi.bulkPromote(token, [...selected], false);
      // The server broadcasts invoice.queued per row; swallow our own echoes so
      // we show one summary instead of N "Invoice queued" toasts.
      for (const id of res.invoice_ids) suppressQueuedEcho(id);
      pushNotification({
        tone: res.queued > 0 ? "success" : "info",
        title: res.queued > 0 ? `Moved ${res.queued} to queue` : "Nothing to move",
        body: res.skipped > 0 ? `${res.skipped} skipped (not drafts).` : undefined,
      });
      setSelected(new Set());
      reload();
    } catch (e) {
      pushNotification({ tone: "danger", title: "Move to queue failed", body: String(e) });
    } finally {
      setBulkBusy(false);
    }
  }

  async function bulkSubmit() {
    const token = getToken();
    if (!token || selectedCount === 0) return;
    setBulkBusy(true);
    try {
      const res = await invoicesApi.bulkPromote(token, [...selected], true);
      if (res.invoice_ids.length > 0) {
        // Track each invoice's SSE lifecycle into a single summary notification.
        trackSubmitBatch(res.invoice_ids, { onUpdate: debouncedReload });
      }
      pushNotification({
        tone: "info",
        title: `Submitting ${res.queued} invoice${res.queued === 1 ? "" : "s"}…`,
        body: res.skipped > 0
          ? `${res.skipped} skipped (not drafts). You'll get a summary when done.`
          : "You'll get a summary when done.",
      });
      setSelected(new Set());
      reload();
    } catch (e) {
      pushNotification({ tone: "danger", title: "Bulk submit failed", body: String(e) });
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title={<span>Invoices <span className="text-xs font-normal text-[var(--color-fg-muted)]">(live)</span></span>}
        description={`${total.toLocaleString()} invoices${hasFilters ? " match the current filter" : " in this tenant"}.`}
        actions={
          <div className="flex gap-2 flex-wrap">
            <button type="button" onClick={processQueue} disabled={processing} className="btn btn-default"
              title="Release every queued invoice to ZATCA right now, regardless of the daily schedule.">
              {processing ? "Processing…" : "Process queue now"}
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

      <Card className="mb-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex-1 min-w-[220px]">
            <Field label="Status" hint="Tick any combination — leave empty for all.">
              <StatusMultiSelect values={draftStatuses} onChange={changeDraftStatus} />
            </Field>
          </div>
          <div className="flex-1 min-w-[160px]">
            <Field label="Created from">
              <DatePicker value={draftFrom} onChange={setDraftFrom} />
            </Field>
          </div>
          <div className="flex-1 min-w-[160px]">
            <Field label="Created to">
              <DatePicker value={draftTo} onChange={setDraftTo} />
            </Field>
          </div>
          <div className="flex-1 min-w-[200px]">
            <Field label="Search" hint="Invoice number or customer name.">
              <input
                type="search"
                className="input w-full"
                placeholder="e.g. DEMO-STD-005 or Falcon…"
                value={draftQ}
                onChange={(e) => setDraftQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") applyFilters(); }}
              />
            </Field>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-transparent select-none" aria-hidden>·</span>
            <div className="flex gap-2">
              <button className="btn btn-primary" onClick={applyFilters}>Apply filter</button>
              <button className="btn btn-default" onClick={resetFilters}>Reset</button>
            </div>
          </div>
        </div>
        {hasFilters && (
          <div className="mt-2 text-xs text-[var(--color-fg-muted)]">
            {statuses.length > 0 && `${statuses.length} status${statuses.length === 1 ? "" : "es"}`}
            {(statuses.length > 0 && (dateFrom || dateTo)) && " · "}
            {(dateFrom || dateTo) && `${dateFrom || "…"} → ${dateTo || "…"}`}
            {((statuses.length > 0 || dateFrom || dateTo) && q) && " · "}
            {q && `“${q}”`}
            {" applied"}
          </div>
        )}
      </Card>

      {loading && !invMeta.loaded ? (
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
          {selectedCount > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-soft)] px-3 py-2">
              <span className="text-sm font-medium">
                {selectedCount} draft{selectedCount === 1 ? "" : "s"} selected
              </span>
              <div className="flex gap-2 ml-auto">
                <button type="button" className="btn btn-default" disabled={bulkBusy} onClick={bulkMoveToQueue}
                  title="Move the selected drafts into the queue (released on schedule or via 'Process queue now').">
                  {bulkBusy ? "Working…" : `Move ${selectedCount} to queue`}
                </button>
                <button type="button" className="btn btn-primary" disabled={bulkBusy} onClick={bulkSubmit}
                  title="Submit the selected drafts to ZATCA now. Runs in the background; you'll get a single summary.">
                  {bulkBusy ? "Working…" : `Submit ${selectedCount} now`}
                </button>
                <button type="button" className="btn btn-default" disabled={bulkBusy} onClick={() => setSelected(new Set())}>
                  Clear
                </button>
              </div>
            </div>
          )}
          <Card>
            <table className="responsive-table">
              <thead>
                <tr>
                  <th className="w-8">
                    <input
                      type="checkbox"
                      aria-label="Select all drafts on this page"
                      checked={allDraftsSelected}
                      disabled={draftIds.length === 0}
                      onChange={(e) => toggleAllDrafts(e.target.checked)}
                    />
                  </th>
                  <th>ICV</th>
                  <th>Invoice #</th>
                  <th>Customer</th>
                  <th>Type</th>
                  <th>Issue date</th>
                  <th>Status</th>
                  <th className="text-right">Total{defaultCurrency ? ` (${defaultCurrency})` : ""}</th>
                  <th className="text-right"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id}
                    className={`hover:bg-[var(--color-bg-hover)] transition-colors ${pulse.has(r.id) ? "bg-[var(--color-warning-soft)]" : ""}`}>
                    <td data-label="" className="w-8">
                      {r.status === "draft" ? (
                        <input
                          type="checkbox"
                          aria-label={`Select draft ICV ${r.icv}`}
                          checked={selected.has(r.id)}
                          onChange={(e) => toggleOne(r.id, e.target.checked)}
                        />
                      ) : null}
                    </td>
                    <td data-label="ICV" className="font-mono">{r.icv}</td>
                    <td data-label="Invoice #">{r.invoice_number ?? `—`}</td>
                    <td data-label="Customer" className="text-[var(--color-fg-2)]">{r.customer_name ?? "—"}</td>
                    <td data-label="Type" className="text-[var(--color-fg-muted)]">{r.doc_type}</td>
                    <td data-label="Issue date" className="text-[var(--color-fg-muted)]">{r.issue_date ? formatDDMMYYYY(r.issue_date) : "—"}</td>
                    <td data-label="Status">
                      <span className="inline-flex items-center gap-2">
                        <StatusDot status={r.status} />
                        <span className="text-[var(--color-fg-2)]">{r.status}</span>
                      </span>
                    </td>
                    <td data-label="Total" className="md:text-right tabular-nums">{r.payable_amount ?? "—"}</td>
                    <td data-label="Actions" className="md:text-right">
                      <RowActions item={r} onRelease={releaseOne} onPromote={promoteDraft} onRetry={retryRejected} />
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
    </div>
  );
}

/* ISO yyyy-mm-dd → dd-mm-yyyy display */
function formatDDMMYYYY(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : iso;
}

/* Row actions: ⋮ menu instead of a strip of buttons */
function RowActions({
  item, onRelease, onPromote, onRetry,
}: {
  item: InvoiceListItem;
  onRelease: (id: string) => void;
  onPromote: (id: string, submit_now: boolean) => void;
  onRetry: (id: string) => void;
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

  const issued = item.status === "cleared" || item.status === "reported";
  // Issued invoices are immutable at ZATCA → amend with a credit/debit note.
  const canAmend = issued && !item.doc_type.includes("_note");
  // Not-yet-issued invoices can be edited in place (re-signed).
  const EDITABLE = ["draft", "queued", "retrying", "rejected", "failed_pending_review", "local_only"];
  const canEditInPlace = EDITABLE.includes(item.status);
  const canRelease = item.status === "queued" || item.status === "retrying";
  const canRetry = item.status === "rejected" || item.status === "failed_pending_review";
  const isDraft = item.status === "draft";

  return (
    <div className="relative inline-block text-left" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Row actions"
        className="inline-flex items-center justify-center w-8 h-8 rounded-md text-[var(--color-fg-2)] hover:bg-[var(--color-bg-hover)] border border-transparent hover:border-[var(--color-border)]"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="12" cy="5"  r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="12" cy="19" r="1.6" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 mt-1 z-30 w-48 bg-white border border-[var(--color-border)] rounded-md shadow-lg overflow-hidden">
          <Link
            href={`/dashboard/invoices/${item.id}`}
            onClick={() => setOpen(false)}
            className="block px-3 py-2 text-sm text-[var(--color-fg-2)] hover:bg-[var(--color-bg-hover)]"
          >
            Open
          </Link>
          {isDraft && (
            <>
              <button
                type="button"
                onClick={() => { setOpen(false); onPromote(item.id, false); }}
                className="w-full text-left block px-3 py-2 text-sm text-[var(--color-fg-2)] hover:bg-[var(--color-bg-hover)]"
              >
                Move to queue
              </button>
              <button
                type="button"
                onClick={() => { setOpen(false); onPromote(item.id, true); }}
                className="w-full text-left block px-3 py-2 text-sm text-[var(--color-fg-2)] hover:bg-[var(--color-bg-hover)]"
              >
                Submit now
              </button>
            </>
          )}
          {canRelease && (
            <button
              type="button"
              onClick={() => { setOpen(false); onRelease(item.id); }}
              className="w-full text-left block px-3 py-2 text-sm text-[var(--color-fg-2)] hover:bg-[var(--color-bg-hover)]"
            >
              Release now → submit
            </button>
          )}
          {canRetry && (
            <button
              type="button"
              onClick={() => { setOpen(false); onRetry(item.id); }}
              className="w-full text-left block px-3 py-2 text-sm text-[var(--color-fg-2)] hover:bg-[var(--color-bg-hover)]"
            >
              Retry (re-sign + resubmit)
            </button>
          )}
          {canEditInPlace && (
            <Link
              href={`/dashboard/invoices/new?edit=${item.id}`}
              onClick={() => setOpen(false)}
              className="block px-3 py-2 text-sm text-[var(--color-fg-2)] hover:bg-[var(--color-bg-hover)]"
            >
              Edit invoice
            </Link>
          )}
          {canAmend && (
            <Link
              href={`/dashboard/invoices/new?amend=${item.id}`}
              onClick={() => setOpen(false)}
              className="block px-3 py-2 text-sm text-[var(--color-fg-2)] hover:bg-[var(--color-bg-hover)]"
            >
              Amend (credit / debit note)
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

/* Multi-select with chips inside the trigger */
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

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="input text-left flex items-center gap-1.5 flex-wrap min-h-[38px] w-full"
      >
        {values.length === 0 ? (
          <span className="text-[var(--color-fg-faint)]">All statuses</span>
        ) : (
          values.map((v) => {
            const lbl = STATUS_OPTIONS.find((o) => o.value === v)?.label ?? v;
            return (
              <span key={v} className="chip">
                <StatusDot status={v} />
                <span className="ml-1">{lbl}</span>
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => { e.stopPropagation(); onChange(v, false); }}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); onChange(v, false); } }}
                  className="text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] cursor-pointer pl-1"
                >
                  ×
                </span>
              </span>
            );
          })
        )}
        <span className="ml-auto text-[var(--color-fg-muted)]">▾</span>
      </button>
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
