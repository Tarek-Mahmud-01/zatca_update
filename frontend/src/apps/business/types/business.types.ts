export interface BusinessSettings {
  tenant_id: string;
  name: string;
  vat_number: string;
  organization_identifier: string;
  currency: string;        // ISO 4217 — e.g. SAR (legacy "selected default")
  trade_name: string | null;
  branch_name: string | null;
}
