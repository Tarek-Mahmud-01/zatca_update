/**
 * Onboarding feature types — ZATCA CSID lifecycle responses and compliance
 * check shapes.
 */
export type Env = "sandbox" | "simulation" | "production";

export interface CsrResponse {
  csid_id: string;
  csr_pem: string;
}

export interface ComplianceResponse {
  csid_id: string;
  request_id: string;
  issued_at: string;
}

export interface ProductionResponse {
  csid_id: string;
  issued_at: string;
}

export interface RenewalResponse {
  csid_id: string;
  issued_at: string;
  replaced_csid_id: string;
}

export interface ComplianceCheckItem {
  scenario: string;
  doc_type: string;
  invoice_number: string;
  http_status: number | null;
  zatca_status: string | null;
  passed: boolean;
  error: string | null;
}

export interface ComplianceCheckResponse {
  invoice_type: string;
  total: number;
  passed: number;
  all_passed: boolean;
  items: ComplianceCheckItem[];
}

export interface CompliancePreviewItem {
  scenario: string;
  doc_type: string;
  description: string;
}
