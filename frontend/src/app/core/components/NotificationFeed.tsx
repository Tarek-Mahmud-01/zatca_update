"use client";

import { useEffect, useRef } from "react";
import { eventsWsUrl, type InvoiceEvent } from "@/apps/notifications/events";
import { getToken, handleAuthExpired } from "@/apps/auth/utils/token";
import { pushNotification, shouldSuppressQueued, type Tone } from "@/apps/notifications/notifications";
import { handleBatchEvent } from "@/apps/invoices/utils/batch-tracker";

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

const RECONNECT_MAX_MS = 30_000;

/**
 * Mounts once at dashboard layout level. Opens a single WebSocket connection
 * to /api/v1/events/ws?token=<JWT> and pushes every invoice event into the
 * global notification store.  Pages subscribe to the store — they never open
 * their own connection.
 *
 * Auth: the JWT is passed as a query param (browser WebSocket API does not
 * support custom headers). Reconnects with exponential back-off; a 4401 close
 * code means the token is invalid → redirect to login.
 */
export function NotificationFeed() {
  const wsRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);

  useEffect(() => {
    let dead = false;

    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }

    function handle(raw: string) {
      let data: InvoiceEvent & { type: string };
      try { data = JSON.parse(raw); } catch { return; }
      if (data.type === "ping") return;
      // Server-initiated logout via message (more reliable than close codes —
      // browsers can remap custom close codes to 1006 abnormal closure).
      if (data.type === "force_logout" || data.type === "session_expired") {
        handleAuthExpired();
        return;
      }

      if (handleBatchEvent(data.invoice_id, data.type)) return;
      if (data.type === "invoice.queued" && shouldSuppressQueued(data.invoice_id)) return;

      const tone = TONE_BY_TYPE[data.type] ?? "info";
      const title = TITLE_BY_TYPE[data.type] ?? data.type;
      const body =
        `ICV ${data.icv} · ${data.doc_type}` +
        (data.error ? ` — ${data.error.slice(0, 80)}` : "");

      pushNotification({ tone, title, body, href: `/dashboard/invoices/${data.invoice_id}` });

      if (tone !== "info" && typeof Notification !== "undefined" && Notification.permission === "granted") {
        new Notification(title, { body, tag: `inv-${data.invoice_id}` });
      }
    }

    function connect() {
      if (dead) return;
      const token = getToken();
      if (!token) { handleAuthExpired(); return; }

      const ws = new WebSocket(eventsWsUrl(token));
      wsRef.current = ws;

      ws.onopen = () => { attemptRef.current = 0; };

      ws.onmessage = (e: MessageEvent<string>) => { handle(e.data); };

      ws.onclose = (e: CloseEvent) => {
        if (dead) return;
        if (e.code === 4401) { handleAuthExpired(); return; }
        const delay = Math.min(RECONNECT_MAX_MS, 1_000 * 2 ** attemptRef.current);
        attemptRef.current += 1;
        timerRef.current = setTimeout(connect, delay);
      };

      ws.onerror = () => { ws.close(); };
    }

    connect();

    return () => {
      dead = true;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      wsRef.current?.close();
    };
  }, []);

  return null;
}
