"use client";

import { useEffect, useRef } from "react";
import { api, type InvoiceEvent } from "../lib/api-client";
import { getToken, handleAuthExpired } from "../lib/token";
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
 * Mount once at the dashboard layout level. Opens a single EventSource
 * against /api/v1/events, pushes everything into the global notification
 * store. Pages subscribe to the store rather than each opening their own
 * SSE connection.
 *
 * The SSE handshake doubles as the auth canary — no extra polling needed:
 *
 *   - Server accepts (200 + text/event-stream) → readyState=OPEN.
 *     We mark the gate "authed". Browser auto-reconnects on transient drops.
 *
 *   - Server rejects (401) → browser fires `error`, readyState=CLOSED and
 *     STAYS closed (EventSource does NOT auto-retry on non-2xx). That
 *     transition is our signal to bounce to /login.
 *
 *   - Network blip / server restart → readyState briefly = CONNECTING,
 *     browser reconnects automatically. We do nothing.
 */
export function NotificationFeed() {
  // Avoid acting on the burst of error events the browser fires during a
  // normal reconnect. We only treat CLOSED as fatal after a short grace.
  const closedGraceTimer = useRef<number | null>(null);

  useEffect(() => {
    const token = getToken();
    if (!token) { handleAuthExpired(); return; }

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

      if (
        tone !== "info" &&
        typeof Notification !== "undefined" &&
        Notification.permission === "granted"
      ) {
        new Notification(title, { body, tag: `inv-${data.invoice_id}` });
      }
    }

    function onOpen() {
      // Cancel any pending "treat as auth failure" timer — the socket came back.
      if (closedGraceTimer.current !== null) {
        clearTimeout(closedGraceTimer.current);
        closedGraceTimer.current = null;
      }
    }

    function onError() {
      // EventSource readyState semantics:
      //   CONNECTING (0) — transient, browser is reconnecting → ignore
      //   OPEN       (1) — never paired with error
      //   CLOSED     (2) — server returned non-2xx (typically 401) and the
      //                    browser gave up. THIS is our auth-expired signal.
      if (es.readyState !== EventSource.CLOSED) return;
      if (closedGraceTimer.current !== null) return;
      // Tiny grace window in case CLOSED is reported just before a fresh
      // EventSource is created on a route change.
      closedGraceTimer.current = window.setTimeout(() => {
        closedGraceTimer.current = null;
        if (es.readyState === EventSource.CLOSED) handleAuthExpired();
      }, 500);
    }

    es.addEventListener("open", onOpen);
    es.addEventListener("error", onError);

    const types = Object.keys(TONE_BY_TYPE);
    for (const t of types) es.addEventListener(t, handle as EventListener);

    return () => {
      if (closedGraceTimer.current !== null) {
        clearTimeout(closedGraceTimer.current);
        closedGraceTimer.current = null;
      }
      es.removeEventListener("open", onOpen);
      es.removeEventListener("error", onError);
      for (const t of types) es.removeEventListener(t, handle as EventListener);
      es.close();
    };
  }, []);

  return null;
}
