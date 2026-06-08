"use client";

import { useEffect } from "react";
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
 * Mount once at the dashboard layout level. Opens a single SSE connection
 * against /api/v1/events and pushes everything into the global notification
 * store. Pages subscribe to the store rather than each opening their own
 * connection.
 *
 * Auth: EventSource can't send an Authorization header, so instead of putting
 * the long-lived API token in the URL (where it leaks into access logs, history
 * and Referer), we mint a short-lived single-purpose *ticket* over an
 * authenticated POST and open the stream with that throwaway ticket.
 *
 * The ticket endpoint (a normal Bearer-authenticated request) is now the auth
 * canary — if it returns 401, `request()` bounces us to /login. The stream
 * itself is just transport: when it drops we mint a fresh ticket and reconnect
 * with exponential backoff. Tickets expire in ~60s, so a leaked one is inert.
 *
 *   - Stream open            → reset backoff.
 *   - readyState CONNECTING  → browser is retrying the same ticket; let it.
 *   - readyState CLOSED      → ticket died / server refused → reconnect fresh.
 *   - Ticket mint fails 401  → session is dead → handleAuthExpired (via request).
 *   - Ticket mint fails else → backend down / network blip → back off & retry.
 */
const RECONNECT_MAX_MS = 30_000;

export function NotificationFeed() {
  useEffect(() => {
    let stopped = false;
    let es: EventSource | null = null;
    let reconnectTimer: number | null = null;
    let attempt = 0;

    if (!getToken()) { handleAuthExpired(); return; }

    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }

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

    function scheduleReconnect() {
      if (stopped || reconnectTimer !== null) return;
      const delay = Math.min(RECONNECT_MAX_MS, 1_000 * 2 ** attempt);
      attempt += 1;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        void connect();
      }, delay);
    }

    async function connect() {
      if (stopped) return;
      const token = getToken();
      if (!token) { handleAuthExpired(); return; }

      let ticket: string;
      try {
        ticket = (await api.getEventsTicket(token)).ticket;
      } catch (err) {
        // request() already redirected to /login on a 401 ("auth_expired").
        // Anything else (backend down, network blip) is transient → back off.
        if (err instanceof Error && err.message === "auth_expired") return;
        scheduleReconnect();
        return;
      }
      if (stopped) return;

      const source = new EventSource(api.eventsUrl(ticket));
      es = source;

      source.addEventListener("open", () => { attempt = 0; });
      source.addEventListener("error", () => {
        // CONNECTING (0): browser is retrying the same ticket → let it ride.
        // CLOSED (2): ticket expired or server refused → reconnect with a
        // fresh ticket. The mint call will surface a real auth failure.
        if (source.readyState !== EventSource.CLOSED) return;
        source.close();
        if (es === source) es = null;
        scheduleReconnect();
      });

      for (const t of Object.keys(TONE_BY_TYPE)) {
        source.addEventListener(t, handle as EventListener);
      }
    }

    void connect();

    return () => {
      stopped = true;
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      es?.close();
    };
  }, []);

  return null;
}
