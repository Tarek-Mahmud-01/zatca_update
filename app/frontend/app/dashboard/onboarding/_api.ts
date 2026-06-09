/**
 * Onboarding feature API — ZATCA CSID lifecycle (CSR → compliance CCSID →
 * compliance checks → production PCSID → renewal). Only the onboarding page
 * uses these, so they live with the feature.
 */
import { request } from "@/lib/api/client";

type Env = "sandbox" | "simulation" | "production";

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

export const onboardingApi = {
  generateCsr(token: string, env: Env, config: Record<string, unknown>): Promise<CsrResponse> {
    return request("/api/v1/onboarding/csr", {
      method: "POST", body: JSON.stringify({ env, config }), token,
    });
  },
  issueCompliance(token: string, csid_id: string, otp: string): Promise<ComplianceResponse> {
    return request("/api/v1/onboarding/compliance", {
      method: "POST", body: JSON.stringify({ csid_id, otp }), token,
    });
  },
  previewComplianceCheck(token: string, csid_id: string): Promise<CompliancePreviewItem[]> {
    return request(`/api/v1/onboarding/compliance-check/preview?csid_id=${csid_id}`, { token });
  },
  runComplianceCheck(token: string, csid_id: string): Promise<ComplianceCheckResponse> {
    return request("/api/v1/onboarding/compliance-check", {
      method: "POST", body: JSON.stringify({ csid_id }), token,
    });
  },
  issueProduction(token: string, compliance_csid_id: string): Promise<ProductionResponse> {
    return request("/api/v1/onboarding/production", {
      method: "POST", body: JSON.stringify({ compliance_csid_id }), token,
    });
  },
  renewProductionCsid(token: string, body: { env: Env; otp: string }): Promise<RenewalResponse> {
    return request("/api/v1/onboarding/renew", {
      method: "POST", body: JSON.stringify(body), token,
    });
  },
};
