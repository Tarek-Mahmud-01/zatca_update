/**
 * Invoices feature types — the invoice lifecycle data shapes shared across the
 * service, store, and pages.
 */

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
