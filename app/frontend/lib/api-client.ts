/**
 * Thin REST wrapper around the FastAPI backend.
 *
 * Use `npm run gen:api` (when the backend is running) to generate strict types
 * into `lib/api-types.ts` and replace the structural types below.
 */

// 127.0.0.1 (not "localhost") — uvicorn binds IPv4-only and Windows resolves
// "localhost" to IPv6 ::1 first, causing "Failed to fetch". Override with
// BACKEND_URL in the environment if your backend is elsewhere.
const BACKEND = process.env.BACKEND_URL ?? "http://127.0.0.1:8001";

export interface TokenResponse {
  access_token: string;
  token_type: "bearer";
}

export interface Me {
  user_id: string;
  email: string;
  role: string;
  tenant_id: string;
  tenant_name: string;
  vat_number: string;
  organization_identifier: string;
  default_branch_id: string | null;
}

export interface TenantUser {
  id: string;
  email: string;
  role: "admin" | "member" | "viewer";
  created_at: string;
  is_me: boolean;
  default_branch_id: string | null;
}

export type QueueScheduleMode = "times" | "interval";

export interface BusinessSettings {
  tenant_id: string;
  name: string;
  vat_number: string;
  organization_identifier: string;
  currency: string;        // ISO 4217 — e.g. SAR (legacy "selected default")
  trade_name: string | null;
  branch_name: string | null;
}

export interface TenantCurrency {
  id: string;
  code: string;                  // ISO 4217
  exchange_rate: string;         // "1 unit code = exchange_rate units of base"; string for precision
  as_of_date: string;            // ISO yyyy-mm-dd
  is_default: boolean;
}

export interface TenantOrganization {
  id: string;
  name: string;
  trade_name: string | null;
  vat_number: string | null;
  registration_number: string | null;
  street: string | null;
  building_number: string | null;
  city_subdivision: string | null;
  city: string | null;
  postal_zone: string | null;
  country_code: string;
  is_default: boolean;
}

export interface TenantBranch {
  id: string;
  organization_id: string;       // FK → TenantOrganization.id
  name: string;
  code: string | null;
  street: string | null;
  building_number: string | null;
  city_subdivision: string | null;
  city: string | null;
  postal_zone: string | null;
  country_code: string;
  is_default: boolean;
}

export interface TenantSettings {
  queue_strategy: "immediate" | "queued";
  queue_schedule_mode: QueueScheduleMode;
  // Used when mode = "times". List of "HH:MM" (UTC) release times.
  queue_schedule_times: string[];
  // Used when mode = "interval". Minutes between releases, anchored at midnight UTC.
  queue_schedule_interval_minutes: number;
  // Legacy throttle. Server still returns it but ignores it for the new model.
  queue_throttle_per_minute: number;
}

export interface ProcessQueueResult {
  released: number;
  remaining_queued: number;
  schedule_mode: QueueScheduleMode;
  schedule_times: string[];
  schedule_interval_minutes: number;
  skipped_reason: string | null;
}

export interface ReleaseInvoiceResult {
  id: string;
  status: string;
  submit_mode: "arq" | "inline";
}

export interface AmendResult {
  note_kind: "credit_note" | "debit_note";
  delta: string;
  note_invoice_id: string;
  note_icv: number;
  references: string;
}

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

export interface Category { id: string; name: string; description: string | null }

export interface Product {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  category_id: string | null;
  category_name: string | null;
  unit_price: string;
  unit_code: string;
  tax_category: "S" | "Z" | "E" | "O" | "G";
  tax_percent: string;
}

export interface Customer {
  id: string;
  external_id: string | null;
  name: string;
  vat_number: string | null;
  crn: string | null;
  email: string | null;
  phone: string | null;
  street: string;
  building_number: string;
  city_subdivision: string;
  city: string;
  postal_zone: string;
  country_code: string;
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

async function request<T>(
  path: string,
  init: RequestInit & { token?: string | null } = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.token) headers.set("Authorization", `Bearer ${init.token}`);
  if (!(init.body instanceof FormData) && init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(`${BACKEND}${path}`, { ...init, headers });
  if (!res.ok) {
    // Centralised auth-expired handling. Any 401 (and 403 on /me, which
    // means the JWT is no longer valid) wipes the cookie and bounces to
    // /login. Skip the login endpoint itself so a wrong-password error
    // stays visible on the form instead of bouncing.
    const isLoginEndpoint = path.startsWith("/api/v1/auth/login");
    if (!isLoginEndpoint && (res.status === 401 || (res.status === 403 && path.includes("/auth/me")))) {
      const { handleAuthExpired } = await import("./token");
      handleAuthExpired();
      throw new Error("auth_expired");
    }
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

export const api = {
  async login(email: string, password: string): Promise<TokenResponse> {
    const form = new FormData();
    form.append("username", email);
    form.append("password", password);
    return request<TokenResponse>("/api/v1/auth/login", { method: "POST", body: form });
  },

  me(token: string) { return request<Me>("/api/v1/auth/me", { token }); },

  listTenantUsers(token: string) { return request<TenantUser[]>("/api/v1/tenant-users", { token }); },
  inviteTenantUser(
    token: string,
    body: { email: string; password: string; role: string; default_branch_id?: string | null },
  ) {
    return request<TenantUser>("/api/v1/tenant-users", {
      method: "POST", body: JSON.stringify(body), token,
    });
  },
  updateTenantUserRole(token: string, id: string, role: string) {
    return request<TenantUser>(`/api/v1/tenant-users/${id}`, {
      method: "PATCH", body: JSON.stringify({ role }), token,
    });
  },
  updateTenantUserBranch(token: string, id: string, default_branch_id: string | null) {
    return request<TenantUser>(`/api/v1/tenant-users/${id}`, {
      method: "PATCH", body: JSON.stringify({ default_branch_id }), token,
    });
  },
  async removeTenantUser(token: string, id: string): Promise<void> {
    const res = await fetch(`${BACKEND}/api/v1/tenant-users/${id}`, {
      method: "DELETE", headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok && res.status !== 204) throw new Error(`API ${res.status}: ${await res.text()}`);
  },

  async signup(body: {
    tenant_name: string;
    vat_number: string;
    organization_identifier: string;
    email: string;
    password: string;
  }): Promise<TokenResponse> {
    return request("/api/v1/auth/signup", { method: "POST", body: JSON.stringify(body) });
  },

  async generateCsr(token: string, env: "sandbox" | "simulation" | "production", config: Record<string, unknown>): Promise<CsrResponse> {
    return request("/api/v1/onboarding/csr", {
      method: "POST",
      body: JSON.stringify({ env, config }),
      token,
    });
  },

  async issueCompliance(token: string, csid_id: string, otp: string): Promise<ComplianceResponse> {
    return request("/api/v1/onboarding/compliance", {
      method: "POST",
      body: JSON.stringify({ csid_id, otp }),
      token,
    });
  },

  async previewComplianceCheck(token: string, csid_id: string): Promise<CompliancePreviewItem[]> {
    return request(`/api/v1/onboarding/compliance-check/preview?csid_id=${csid_id}`, { token });
  },

  async runComplianceCheck(token: string, csid_id: string): Promise<ComplianceCheckResponse> {
    return request("/api/v1/onboarding/compliance-check", {
      method: "POST",
      body: JSON.stringify({ csid_id }),
      token,
    });
  },

  async issueProduction(token: string, compliance_csid_id: string): Promise<ProductionResponse> {
    return request("/api/v1/onboarding/production", {
      method: "POST",
      body: JSON.stringify({ compliance_csid_id }),
      token,
    });
  },

  async submitInvoice(token: string, body: unknown, idempotencyKey?: string): Promise<SubmitInvoiceResponse> {
    const headers: Record<string, string> = {};
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    return request("/api/v1/invoices", {
      method: "POST",
      body: JSON.stringify(body),
      headers,
      token,
    });
  },

  async submitBatch(
    token: string,
    env: "sandbox" | "simulation" | "production",
    payloads: unknown[],
  ): Promise<BatchInvoiceResponse> {
    return request("/api/v1/invoices/batch", {
      method: "POST",
      body: JSON.stringify({ env, payloads }),
      token,
    });
  },

  async seedDemoInvoices(
    token: string,
    env: "sandbox" | "simulation" | "production",
    bitmask: "1000" | "0100" | "1100" = "1100",
  ): Promise<{ created: number; invoice_ids: string[]; used_dev_csid: boolean }> {
    return request("/api/v1/invoices/demo-seed", {
      method: "POST",
      body: JSON.stringify({ env, bitmask }),
      token,
    });
  },

  eventsUrl(token: string): string {
    return `${BACKEND}/api/v1/events?token=${encodeURIComponent(token)}`;
  },

  async getInvoice(token: string, id: string): Promise<InvoiceDetail> {
    return request(`/api/v1/invoices/${id}`, { token });
  },

  async listInvoices(
    token: string,
    opts: {
      page?: number;
      page_size?: number;
      statuses?: string[];
      date_from?: string;
      date_to?: string;
    } = {},
  ): Promise<InvoiceListPage> {
    const qs = new URLSearchParams();
    qs.set("page",      String(opts.page ?? 1));
    qs.set("page_size", String(opts.page_size ?? 25));
    if (opts.statuses && opts.statuses.length > 0) qs.set("statuses", opts.statuses.join(","));
    if (opts.date_from) qs.set("date_from", opts.date_from);
    if (opts.date_to)   qs.set("date_to",   opts.date_to);
    return request<InvoiceListPage>(`/api/v1/invoices?${qs}`, { token });
  },

  // ---- Categories ----
  listCategories(token: string) { return request<Category[]>("/api/v1/categories", { token }); },
  createCategory(token: string, body: Partial<Category>) {
    return request<Category>("/api/v1/categories", { method: "POST", body: JSON.stringify(body), token });
  },
  updateCategory(token: string, id: string, body: Partial<Category>) {
    return request<Category>(`/api/v1/categories/${id}`, { method: "PATCH", body: JSON.stringify(body), token });
  },
  async deleteCategory(token: string, id: string): Promise<void> {
    const res = await fetch(`${BACKEND}/api/v1/categories/${id}`, {
      method: "DELETE", headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok && res.status !== 204) throw new Error(`API ${res.status}: ${await res.text()}`);
  },

  // ---- Products ----
  listProducts(token: string, opts: { q?: string; category_id?: string } = {}) {
    const qs = new URLSearchParams();
    if (opts.q) qs.set("q", opts.q);
    if (opts.category_id) qs.set("category_id", opts.category_id);
    const tail = qs.toString();
    return request<Product[]>(`/api/v1/products${tail ? `?${tail}` : ""}`, { token });
  },
  getProduct(token: string, id: string)             { return request<Product>(`/api/v1/products/${id}`, { token }); },
  createProduct(token: string, body: Partial<Product>) {
    return request<Product>("/api/v1/products", { method: "POST", body: JSON.stringify(body), token });
  },
  updateProduct(token: string, id: string, body: Partial<Product>) {
    return request<Product>(`/api/v1/products/${id}`, { method: "PATCH", body: JSON.stringify(body), token });
  },
  async deleteProduct(token: string, id: string): Promise<void> {
    const res = await fetch(`${BACKEND}/api/v1/products/${id}`, {
      method: "DELETE", headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok && res.status !== 204) throw new Error(`API ${res.status}: ${await res.text()}`);
  },

  // ---- Customers ----
  listCustomers(token: string, q?: string) {
    return request<Customer[]>(`/api/v1/customers${q ? `?q=${encodeURIComponent(q)}` : ""}`, { token });
  },
  getCustomer(token: string, id: string)             { return request<Customer>(`/api/v1/customers/${id}`, { token }); },
  createCustomer(token: string, body: Partial<Customer>) {
    return request<Customer>("/api/v1/customers", { method: "POST", body: JSON.stringify(body), token });
  },
  updateCustomer(token: string, id: string, body: Partial<Customer>) {
    return request<Customer>(`/api/v1/customers/${id}`, { method: "PATCH", body: JSON.stringify(body), token });
  },
  async deleteCustomer(token: string, id: string): Promise<void> {
    const res = await fetch(`${BACKEND}/api/v1/customers/${id}`, {
      method: "DELETE", headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok && res.status !== 204) throw new Error(`API ${res.status}: ${await res.text()}`);
  },

  // ---- Business profile (legacy single-field shape) ----
  getBusinessSettings(token: string) {
    return request<BusinessSettings>("/api/v1/settings/business", { token });
  },
  putBusinessSettings(
    token: string,
    body: { currency: string; trade_name: string | null; branch_name: string | null },
  ) {
    return request<BusinessSettings>("/api/v1/settings/business", {
      method: "PUT", body: JSON.stringify(body), token,
    });
  },

  // ---- Tenant currencies (multi) ----
  listCurrencies(token: string) {
    return request<TenantCurrency[]>("/api/v1/settings/currencies", { token });
  },
  createCurrency(
    token: string,
    body: { code: string; exchange_rate: string; as_of_date?: string; is_default?: boolean },
  ) {
    return request<TenantCurrency>("/api/v1/settings/currencies", {
      method: "POST", body: JSON.stringify(body), token,
    });
  },
  updateCurrency(
    token: string, id: string,
    body: { code: string; exchange_rate: string; as_of_date?: string; is_default?: boolean },
  ) {
    return request<TenantCurrency>(`/api/v1/settings/currencies/${id}`, {
      method: "PATCH", body: JSON.stringify(body), token,
    });
  },
  async deleteCurrency(token: string, id: string): Promise<void> {
    const res = await fetch(`${BACKEND}/api/v1/settings/currencies/${id}`, {
      method: "DELETE", headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok && res.status !== 204) throw new Error(`API ${res.status}: ${await res.text()}`);
  },

  // ---- Tenant organizations (multi) ----
  listOrganizations(token: string) {
    return request<TenantOrganization[]>("/api/v1/settings/organizations", { token });
  },
  createOrganization(token: string, body: Partial<TenantOrganization>) {
    return request<TenantOrganization>("/api/v1/settings/organizations", {
      method: "POST", body: JSON.stringify(body), token,
    });
  },
  updateOrganization(token: string, id: string, body: Partial<TenantOrganization>) {
    return request<TenantOrganization>(`/api/v1/settings/organizations/${id}`, {
      method: "PATCH", body: JSON.stringify(body), token,
    });
  },
  async deleteOrganization(token: string, id: string): Promise<void> {
    const res = await fetch(`${BACKEND}/api/v1/settings/organizations/${id}`, {
      method: "DELETE", headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok && res.status !== 204) throw new Error(`API ${res.status}: ${await res.text()}`);
  },

  // ---- Tenant branches (multi, FK → organization) ----
  listBranches(token: string) {
    return request<TenantBranch[]>("/api/v1/settings/branches", { token });
  },
  createBranch(token: string, body: Partial<TenantBranch> & { organization_id: string }) {
    return request<TenantBranch>("/api/v1/settings/branches", {
      method: "POST", body: JSON.stringify(body), token,
    });
  },
  updateBranch(
    token: string, id: string,
    body: Partial<TenantBranch> & { organization_id: string },
  ) {
    return request<TenantBranch>(`/api/v1/settings/branches/${id}`, {
      method: "PATCH", body: JSON.stringify(body), token,
    });
  },
  async deleteBranch(token: string, id: string): Promise<void> {
    const res = await fetch(`${BACKEND}/api/v1/settings/branches/${id}`, {
      method: "DELETE", headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok && res.status !== 204) throw new Error(`API ${res.status}: ${await res.text()}`);
  },

  // ---- Tenant queue settings ----
  getTenantSettings(token: string) {
    return request<TenantSettings>("/api/v1/settings/tenant", { token });
  },
  putTenantSettings(
    token: string,
    body: {
      queue_strategy: "immediate" | "queued";
      queue_schedule_mode: QueueScheduleMode;
      queue_schedule_times: string[];
      queue_schedule_interval_minutes: number;
      queue_throttle_per_minute: number;
    },
  ) {
    return request<TenantSettings>("/api/v1/settings/tenant", {
      method: "PUT", body: JSON.stringify(body), token,
    });
  },

  // ---- Queue ops ----
  // force=false: only release if current UTC HH:MM matches a scheduled time.
  // force=true : ignore schedule, release all queued items in one batch.
  processQueue(token: string, opts: { force?: boolean } = {}) {
    return request<ProcessQueueResult>("/api/v1/invoices/process-queue", {
      method: "POST",
      body: JSON.stringify({ force: !!opts.force }),
      token,
    });
  },

  releaseInvoice(token: string, id: string) {
    return request<ReleaseInvoiceResult>(`/api/v1/invoices/${id}/release`, {
      method: "POST", token,
    });
  },

  promoteDraft(token: string, id: string, opts: { submit_now?: boolean } = {}) {
    return request<PromoteDraftResult>(`/api/v1/invoices/${id}/promote`, {
      method: "POST",
      body: JSON.stringify({ submit_now: !!opts.submit_now }),
      token,
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
