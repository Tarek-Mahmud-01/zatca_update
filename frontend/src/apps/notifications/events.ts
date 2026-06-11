/**
 * Live-events domain — WebSocket URL builder + event shape.
 * Consumed by NotificationFeed and the use-invoice-events hook.
 */
import { BACKEND } from "@/apps/http/client";

/** Convert http(s):// base URL to ws(s):// */
const WS_BASE = BACKEND.replace(/^http/, "ws");

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

export function eventsWsUrl(token: string): string {
  return `${WS_BASE}/api/v1/events/ws?token=${encodeURIComponent(token)}`;
}
