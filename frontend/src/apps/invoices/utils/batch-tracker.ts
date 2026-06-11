"use client";

import { pushNotification } from "@/apps/notifications/notifications";

/**
 * Bulk-submit progress tracker.
 *
 * When the user submits many drafts at once, the server dispatches them
 * asynchronously and each one emits its own lifecycle events over SSE. We don't
 * want one toast per invoice — we want a single summary at the end ("8
 * submitted · 2 failed"). This module owns that: `trackSubmitBatch` registers
 * the invoice ids, `handleBatchEvent` (called from the single SSE consumer)
 * swallows those per-invoice events and tallies them, and a summary
 * notification is pushed once every id reaches a terminal state (or a timeout
 * elapses, so a stuck invoice can't hang the summary forever).
 */

const SUCCESS_TYPES = new Set(["invoice.reported", "invoice.cleared"]);
// Terminal for the purpose of a submit batch — once seen, the invoice is done.
// local_only (dev cert) and rejected/failed/retrying all count as "not sent".
const TERMINAL_TYPES = new Set([
  "invoice.reported", "invoice.cleared", "invoice.failed",
  "invoice.rejected", "invoice.local_only", "invoice.retrying",
]);

interface Batch {
  pending: Set<string>;
  total: number;
  ok: number;
  fail: number;
  timer: number | null;
  onUpdate?: () => void;
}

const _batches: Batch[] = [];

export function trackSubmitBatch(
  ids: string[],
  opts: { onUpdate?: () => void; timeoutMs?: number } = {},
): void {
  if (ids.length === 0) return;
  const batch: Batch = {
    pending: new Set(ids),
    total: ids.length,
    ok: 0,
    fail: 0,
    timer: null,
    onUpdate: opts.onUpdate,
  };
  const timeoutMs = opts.timeoutMs ?? 120_000;
  batch.timer = window.setTimeout(() => finish(batch, true), timeoutMs);
  _batches.push(batch);
}

/**
 * Route an invoice event into any active batch that owns it. Returns true if
 * the event was consumed (the caller must NOT push its own notification).
 * Interim events (queued/signed) for a tracked id are swallowed but leave the
 * id pending; terminal events resolve it.
 */
export function handleBatchEvent(invoiceId: string, type: string): boolean {
  for (const b of _batches) {
    if (!b.pending.has(invoiceId)) continue;
    if (!TERMINAL_TYPES.has(type)) return true;  // interim — swallow, still pending
    b.pending.delete(invoiceId);
    if (SUCCESS_TYPES.has(type)) b.ok += 1; else b.fail += 1;
    b.onUpdate?.();
    if (b.pending.size === 0) finish(b, false);
    return true;
  }
  return false;
}

function finish(b: Batch, timedOut: boolean): void {
  const i = _batches.indexOf(b);
  if (i === -1) return;  // already finished (e.g. completed then timer fired)
  _batches.splice(i, 1);
  if (b.timer !== null) clearTimeout(b.timer);

  const stillPending = b.pending.size;
  const tone = b.fail > 0 ? (b.ok > 0 ? "warning" : "danger") : "success";
  const parts = [`${b.ok} submitted`];
  if (b.fail > 0) parts.push(`${b.fail} failed`);
  if (stillPending > 0) parts.push(`${stillPending} still processing`);

  pushNotification({
    tone,
    title: timedOut ? "Bulk submit — still working" : "Bulk submit complete",
    body: `${parts.join(" · ")} (of ${b.total}).`,
    href: "/dashboard/invoices",
  });
  b.onUpdate?.();
}
