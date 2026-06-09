/**
 * Invoices feature API — the invoice lifecycle: create / edit-in-place / batch
 * / list / detail / queue ops / amend. Owned by the invoices feature; the
 * dashboard overview imports `getInvoiceStats` from here, and the invoices
 * Redux slice imports `listInvoices`.
 */
import { request } from "@/lib/api/client";

type Env = "sandbox" | "simulation" | "production";

export interface InvoiceStats {
  total: number;
  cleared: number;
  reported: number;
  queued: number;
  failed: number;
}

export interface SubmitInvoiceResponse {
  id: string;
  status: string;
  invoice_hash: string;
  icv: number;
  submit_mode?: "immediate" | "queued" | "draft";
}

export interface PromoteDraftResult {
  id: string;
  status: string;
  submit_mode: "queued" | "arq" | "inline";
}

export interface BulkPromoteResult {
  queued: number;          // drafts moved to "queued"
  skipped: number;         // ids not found / not a draft
  submitting: boolean;     // true if an async submission run was started
  invoice_ids: string[];   // promoted ids — track these over SSE
}

export interface BatchInvoiceItem {
  id: string;
  status: string;
  invoice_hash: string;
  icv: number;
}

export interface BatchInvoiceResponse {
  batch_id: string;
  accepted: number;
  items: BatchInvoiceItem[];
}

export interface InvoiceSubmission {
  id: string;
  kind: string;
  http_status: number | null;
  zatca_status: string | null;
  attempt: number;
  submitted_at: string | null;
  response_payload: Record<string, unknown> | null;
}

export interface InvoiceDetail {
  id: string;
  env: string;
  uuid: string;
  icv: number;
  doc_type: string;
  subtype: string;
  status: string;
  invoice_hash: string | null;
  qr_base64: string | null;
  last_error: string | null;
  payload_json: Record<string, unknown>;
  signed_xml: string | null;
  cleared_xml: string | null;
  signed_at: string | null;
  submitted_at: string | null;
  created_at: string;
  submissions: InvoiceSubmission[];
}

export interface InvoiceListItem {
  id: string;
  icv: number;
  doc_type: string;
  status: string;
  created_at: string;
  invoice_number: string | null;
  customer_name: string | null;
  issue_date: string | null;
  payable_amount: string | null;
}

export interface InvoiceListPage {
  items: InvoiceListItem[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface ProcessQueueResult {
  released: number;
  remaining_queued: number;
  schedule_mode: "times" | "interval";
  schedule_times: string[];
  schedule_interval_minutes: number;
  skipped_reason: string | null;
}

export interface ReleaseInvoiceResult {
  id: string;
  status: string;
  submit_mode: "arq" | "inline";
}

export interface RetryInvoiceResult {
  id: string;
  status: string;
  icv: number;
  last_error: string | null;
  resigned: boolean;
}

export interface AmendResult {
  note_kind: "credit_note" | "debit_note";
  delta: string;
  note_invoice_id: string;
  note_icv: number;
  references: string;
}

export const invoicesApi = {
  // Lightweight dashboard counters — one grouped COUNT, not a 200-row page.
  getInvoiceStats(token: string) { return request<InvoiceStats>("/api/v1/invoices/stats", { token }); },

  submitInvoice(token: string, body: unknown, idempotencyKey?: string): Promise<SubmitInvoiceResponse> {
    const headers: Record<string, string> = {};
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    return request("/api/v1/invoices", { method: "POST", body: JSON.stringify(body), headers, token });
  },

  // Edit-in-place for a not-yet-issued invoice. Re-signs with the same ICV/UUID.
  // 409 if the invoice is already cleared/reported (amend with a note instead).
  replaceInvoice(
    token: string, id: string, payload: unknown,
    submit_mode: "immediate" | "queued" | "draft" = "draft",
  ): Promise<SubmitInvoiceResponse> {
    return request(`/api/v1/invoices/${id}`, {
      method: "PUT", body: JSON.stringify({ payload, submit_mode }), token,
    });
  },

  submitBatch(
    token: string, env: Env, payloads: unknown[],
    submit_mode: "immediate" | "queued" = "immediate",
  ): Promise<BatchInvoiceResponse> {
    return request("/api/v1/invoices/batch", {
      method: "POST", body: JSON.stringify({ env, payloads, submit_mode }), token,
    });
  },

  seedDemoInvoices(
    token: string, env: Env, bitmask: "1000" | "0100" | "1100" = "1100",
  ): Promise<{ created: number; invoice_ids: string[]; used_dev_csid: boolean }> {
    return request("/api/v1/invoices/demo-seed", {
      method: "POST", body: JSON.stringify({ env, bitmask }), token,
    });
  },

  getInvoice(token: string, id: string): Promise<InvoiceDetail> {
    return request(`/api/v1/invoices/${id}`, { token });
  },

  listInvoices(
    token: string,
    opts: { page?: number; page_size?: number; statuses?: string[]; date_from?: string; date_to?: string; q?: string } = {},
  ): Promise<InvoiceListPage> {
    const qs = new URLSearchParams();
    qs.set("page",      String(opts.page ?? 1));
    qs.set("page_size", String(opts.page_size ?? 25));
    if (opts.statuses && opts.statuses.length > 0) qs.set("statuses", opts.statuses.join(","));
    if (opts.date_from) qs.set("date_from", opts.date_from);
    if (opts.date_to)   qs.set("date_to",   opts.date_to);
    if (opts.q && opts.q.trim()) qs.set("q", opts.q.trim());
    return request<InvoiceListPage>(`/api/v1/invoices?${qs}`, { token });
  },

  // Move many drafts to the queue at once. submit_now=true also dispatches them
  // to ZATCA asynchronously (server returns immediately; track via SSE).
  bulkPromote(token: string, ids: string[], submit_now: boolean) {
    return request<BulkPromoteResult>("/api/v1/invoices/bulk-promote", {
      method: "POST", body: JSON.stringify({ ids, submit_now }), token,
    });
  },

  // force=false: only release if current UTC HH:MM matches a scheduled time.
  // force=true : ignore schedule, release all queued items in one batch.
  processQueue(token: string, opts: { force?: boolean } = {}) {
    return request<ProcessQueueResult>("/api/v1/invoices/process-queue", {
      method: "POST", body: JSON.stringify({ force: !!opts.force }), token,
    });
  },

  releaseInvoice(token: string, id: string) {
    return request<ReleaseInvoiceResult>(`/api/v1/invoices/${id}/release`, { method: "POST", token });
  },

  retryInvoice(token: string, id: string) {
    return request<RetryInvoiceResult>(`/api/v1/invoices/${id}/retry`, { method: "POST", token });
  },

  promoteDraft(token: string, id: string, opts: { submit_now?: boolean } = {}) {
    return request<PromoteDraftResult>(`/api/v1/invoices/${id}/promote`, {
      method: "POST", body: JSON.stringify({ submit_now: !!opts.submit_now }), token,
    });
  },

  resignInvoice(token: string, id: string) {
    return request<InvoiceDetail>(`/api/v1/invoices/${id}/resign`, { method: "POST", token });
  },

  // ---- Invoice amend (auto CN/DN for delta) ----
  amendInvoice(token: string, id: string, body: { new_payable: string; reason: string }) {
    return request<AmendResult>(`/api/v1/invoices/${id}/amend`, {
      method: "POST", body: JSON.stringify(body), token,
    });
  },
};
