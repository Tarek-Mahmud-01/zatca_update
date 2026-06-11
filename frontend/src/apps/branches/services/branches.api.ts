/**
 * Branches feature API (FK → organization). Owned here; the users page and the
 * invoice editor import `branchesApi` from this module.
 */
import { request, del } from "@/apps/http/client";
import type { TenantBranch, BranchBody } from "../types/branch.types";

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
