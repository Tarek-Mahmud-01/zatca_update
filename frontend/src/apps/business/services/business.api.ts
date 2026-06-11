/**
 * Business-settings feature API — tenant identity / legacy single-field
 * business profile. Only the Business settings page uses it.
 */
import { request } from "@/apps/http/client";
import type { BusinessSettings } from "../types/business.types";

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
