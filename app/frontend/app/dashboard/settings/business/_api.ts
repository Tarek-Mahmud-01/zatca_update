/**
 * Business-settings feature API — tenant identity / legacy single-field
 * business profile. Only the Business settings page uses it.
 */
import { request } from "@/lib/api/client";

export interface BusinessSettings {
  tenant_id: string;
  name: string;
  vat_number: string;
  organization_identifier: string;
  currency: string;        // ISO 4217 — e.g. SAR (legacy "selected default")
  trade_name: string | null;
  branch_name: string | null;
}

export const businessApi = {
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
};
