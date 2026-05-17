"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, type InvoiceEvent } from "../../lib/api-client";
import { getToken } from "../../lib/token";
import { useInvoiceEvents } from "../../lib/use-invoice-events";
import { Card, PageHeader, StatusDot } from "../../components/ui";

interface Counts {
  total: number;
  cleared: number;
  reported: number;
  queued: number;
  failed: number;
}
const EMPTY: Counts = { total: 0, cleared: 0, reported: 0, queued: 0, failed: 0 };

export default function OverviewPage() {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [lastEvent, setLastEvent] = useState<InvoiceEvent | null>(null);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    api.listInvoices(token, { page_size: 200 }).then(({ items }) => {
      const c = { ...EMPTY, total: items.length };
      for (const i of items) {
        if (i.status === "cleared")  c.cleared++;
        else if (i.status === "reported") c.reported++;
        else if (i.status === "queued" || i.status === "retrying") c.queued++;
        else if (i.status.startsWith("failed") || i.status === "rejected") c.failed++;
      }
      setCounts(c);
    });
  }, []);

  useInvoiceEvents((event) => {
    setLastEvent(event);
    setCounts((prev) => {
      const c = { ...(prev ?? EMPTY) };
      if (event.type === "invoice.queued")   { c.total++; c.queued++; }
      else if (event.type === "invoice.cleared")  { c.cleared++;  c.queued = Math.max(0, c.queued - 1); }
      else if (event.type === "invoice.reported") { c.reported++; c.queued = Math.max(0, c.queued - 1); }
      else if (event.type === "invoice.rejected" || event.type === "invoice.failed") {
        c.failed++; c.queued = Math.max(0, c.queued - 1);
      }
      return c;
    });
  });

  return (
    <div>
      <PageHeader
        title={<span>Overview <span className="text-xs font-normal text-[var(--color-fg-muted)]">(live)</span></span>}
        description="Activity at a glance. Counters update as invoices clear."
      />

      {counts ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
          <Metric label="Total"    value={counts.total} />
          <Metric label="Queued"   value={counts.queued}   tone="warning" />
          <Metric label="Cleared"  value={counts.cleared}  tone="success" />
          <Metric label="Reported" value={counts.reported} tone="success" />
          <Metric label="Failed"   value={counts.failed}   tone="danger" />
        </div>
      ) : (
        <p className="muted">Loading…</p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card title="Recent activity">
          {lastEvent ? (
            <div className="flex flex-col gap-1.5 text-sm">
              <div className="flex items-center gap-2">
                <StatusDot status={lastEvent.status} />
                <code className="text-xs">{lastEvent.type}</code>
              </div>
              <div className="text-[var(--color-fg-2)]">
                ICV <span className="font-mono">{lastEvent.icv}</span> · {lastEvent.doc_type}
              </div>
              {lastEvent.error && (
                <div className="text-xs text-[var(--color-danger)]">{lastEvent.error}</div>
              )}
            </div>
          ) : (
            <p className="muted text-sm">No events yet. Submit an invoice to see it here.</p>
          )}
        </Card>

        <Card title="Quick links">
          <ul className="flex flex-col gap-2 text-sm">
            <li><Link href="/dashboard/invoices/new"   className="text-[var(--color-accent)] hover:underline">→ New invoice</Link></li>
            <li><Link href="/dashboard/invoices/batch" className="text-[var(--color-accent)] hover:underline">→ Batch upload</Link></li>
            <li><Link href="/dashboard/products"       className="text-[var(--color-accent)] hover:underline">→ Manage products</Link></li>
            <li><Link href="/dashboard/customers"      className="text-[var(--color-accent)] hover:underline">→ Manage customers</Link></li>
            <li><Link href="/dashboard/onboarding"     className="text-[var(--color-accent)] hover:underline">→ Onboarding wizard</Link></li>
          </ul>
        </Card>
      </div>
    </div>
  );
}

function Metric({ label, value, tone = "neutral" }: { label: string; value: number; tone?: "neutral" | "success" | "warning" | "danger" }) {
  const ring = {
    neutral: "border-[var(--color-border)]",
    success: "border-[var(--color-success)]/30",
    warning: "border-[var(--color-warning)]/30",
    danger:  "border-[var(--color-danger)]/30",
  }[tone];
  const accent = {
    neutral: "text-[var(--color-fg)]",
    success: "text-[var(--color-success)]",
    warning: "text-[var(--color-warning)]",
    danger:  "text-[var(--color-danger)]",
  }[tone];
  return (
    <div className={`bg-white border rounded-lg px-4 py-3 ${ring}`}>
      <div className="label">{label}</div>
      <div className={`text-2xl font-semibold tabular-nums mt-1 ${accent}`}>{value}</div>
    </div>
  );
}
