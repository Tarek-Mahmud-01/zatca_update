"use client";

import { useEffect, useRef } from "react";
import { subscribe, getNotifications, type Notification } from "./notifications";
import type { InvoiceEvent } from "./api-client";

/**
 * Backwards-compatible hook: subscribes to new notifications coming through
 * the global store (fed by the single SSE connection in <NotificationFeed/>).
 * For each new notification matching an invoice event, calls onEvent.
 *
 * Pages don't open their own EventSource anymore — that lives at the layout
 * level so the bell + toaster + every page share the same stream.
 */
export function useInvoiceEvents(onEvent: (e: InvoiceEvent) => void) {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;
  const lastSeenIdRef = useRef<string | null>(null);

  useEffect(() => {
    // Initialize the watermark so we only fire on FUTURE notifications, not
    // ones that were already in the store when the page mounted.
    const initial = getNotifications();
    lastSeenIdRef.current = initial[0]?.id ?? null;

    return subscribe(() => {
      const items = getNotifications();
      const watermark = lastSeenIdRef.current;
      const fresh: Notification[] = [];
      for (const n of items) {
        if (n.id === watermark) break;
        fresh.unshift(n);
      }
      if (items[0]) lastSeenIdRef.current = items[0].id;
      for (const n of fresh) {
        const ev = notificationToEvent(n);
        if (ev) handlerRef.current(ev);
      }
    });
  }, []);
}

function notificationToEvent(n: Notification): InvoiceEvent | null {
  const m = (n.body || "").match(/^ICV\s+(\d+)\s+·\s+(\S+)/);
  const idMatch = (n.href || "").match(/invoices\/([0-9a-f-]+)/i);
  if (!m || !idMatch) return null;
  const typeFromTitle: Record<string, string> = {
    "Invoice queued":   "invoice.queued",
    "Invoice cleared":  "invoice.cleared",
    "Invoice reported": "invoice.reported",
    "Invoice retrying": "invoice.retrying",
    "Invoice rejected": "invoice.rejected",
    "Invoice failed":   "invoice.failed",
  };
  const type = typeFromTitle[n.title] ?? "invoice.event";
  const status = type.split(".")[1] ?? "";
  return {
    type, ts: new Date(n.timestamp).toISOString(),
    invoice_id: idMatch[1], icv: Number(m[1]), doc_type: m[2],
    status,
  };
}
