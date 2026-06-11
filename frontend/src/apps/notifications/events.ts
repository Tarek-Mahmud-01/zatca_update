/**
 * Live-events domain (shared) — SSE ticket + stream URL + the event shape.
 * Consumed by the global NotificationFeed and the use-invoice-events hook.
 */
import { request, BACKEND } from "@/apps/http/client";

export interface EventsTicket {
  ticket: string;
  expires_in: number;  // seconds the ticket is valid for opening the stream
}

export interface InvoiceEvent {
  type: string;
  ts: string;
  invoice_id: string;
  icv: number;
  doc_type: string;
  status: string;
  error?: string;
  batch_id?: string;
}

export const eventsApi = {
  // SSE auth: mint a short-lived ticket over an authenticated POST (token in
  // the header, never the URL), then open the stream with that throwaway
  // ticket. Keeps the long-lived API token out of URLs / access logs.
  getEventsTicket(token: string) {
    return request<EventsTicket>("/api/v1/events/ticket", { method: "POST", token });
  },
  eventsUrl(ticket: string): string {
    return `${BACKEND}/api/v1/events?ticket=${encodeURIComponent(ticket)}`;
  },
};
