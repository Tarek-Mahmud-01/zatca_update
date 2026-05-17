"use client";

import { useEffect } from "react";
import { api, type InvoiceEvent } from "../lib/api-client";
import { getToken } from "../lib/token";
import { pushNotification, type Tone } from "../lib/notifications";

const TONE_BY_TYPE: Record<string, Tone> = {
  "invoice.queued":   "info",
  "invoice.cleared":  "success",
  "invoice.reported": "success",
  "invoice.retrying": "warning",
  "invoice.rejected": "danger",
  "invoice.failed":   "danger",
};

const TITLE_BY_TYPE: Record<string, string> = {
  "invoice.queued":   "Invoice queued",
  "invoice.cleared":  "Invoice cleared",
  "invoice.reported": "Invoice reported",
  "invoice.retrying": "Invoice retrying",
  "invoice.rejected": "Invoice rejected",
  "invoice.failed":   "Invoice failed",
};

/**
 * Mount once at the dashboard layout level. Opens a single EventSource against
 * /api/v1/events, pushes everything into the global notification store. Pages
 * subscribe to the store rather than each opening their own SSE connection.
 */
export function NotificationFeed() {
  useEffect(() => {
    const token = getToken();
    if (!token) return;

    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }

    const es = new EventSource(api.eventsUrl(token));

    function handle(ev: MessageEvent) {
      let data: InvoiceEvent;
      try { data = JSON.parse(ev.data) as InvoiceEvent; } catch { return; }
      const tone = TONE_BY_TYPE[data.type] ?? "info";
      const title = TITLE_BY_TYPE[data.type] ?? data.type;
      const body =
        `ICV ${data.icv} · ${data.doc_type}` +
        (data.error ? ` — ${data.error.slice(0, 80)}` : "");

      pushNotification({
        tone, title, body,
        href: `/dashboard/invoices/${data.invoice_id}`,
      });

      // Native browser notification for terminal states.
      if (
        tone !== "info" &&
        typeof Notification !== "undefined" &&
        Notification.permission === "granted"
      ) {
        new Notification(title, { body, tag: `inv-${data.invoice_id}` });
      }
    }

    const types = Object.keys(TONE_BY_TYPE);
    for (const t of types) es.addEventListener(t, handle as EventListener);

    return () => {
      for (const t of types) es.removeEventListener(t, handle as EventListener);
      es.close();
    };
  }, []);

  return null;
}
