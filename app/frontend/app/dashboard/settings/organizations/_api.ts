/**
 * Organizations feature API. Owned here; the branches page and the invoice
 * editor's supplier block import `organizationsApi` from this module.
 */
import { request, del } from "@/lib/api/client";

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

export const organizationsApi = {
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
  deleteOrganization(token: string, id: string) { return del(token, `/api/v1/settings/organizations/${id}`); },
};
