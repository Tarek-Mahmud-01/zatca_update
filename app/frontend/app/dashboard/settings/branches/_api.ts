/**
 * Branches feature API (FK → organization). Owned here; the users page and the
 * invoice editor import `branchesApi` from this module.
 */
import { request, del } from "@/lib/api/client";

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

type BranchBody = Partial<TenantBranch> & { organization_id: string };

export const branchesApi = {
  listBranches(token: string) {
    return request<TenantBranch[]>("/api/v1/settings/branches", { token });
  },
  createBranch(token: string, body: BranchBody) {
    return request<TenantBranch>("/api/v1/settings/branches", {
      method: "POST", body: JSON.stringify(body), token,
    });
  },
  updateBranch(token: string, id: string, body: BranchBody) {
    return request<TenantBranch>(`/api/v1/settings/branches/${id}`, {
      method: "PATCH", body: JSON.stringify(body), token,
    });
  },
  deleteBranch(token: string, id: string) { return del(token, `/api/v1/settings/branches/${id}`); },
};
