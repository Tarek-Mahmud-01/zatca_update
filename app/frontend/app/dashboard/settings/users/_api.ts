/**
 * Team members (tenant users) feature API. Owned by the Team members settings
 * page; backs its tenantUsers store slice.
 */
import { request, del } from "@/lib/api/client";

export interface TenantUser {
  id: string;
  email: string;
  role: "admin" | "member" | "viewer";
  created_at: string;
  is_me: boolean;
  default_branch_id: string | null;
}

export const tenantUsersApi = {
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
  removeTenantUser(token: string, id: string) { return del(token, `/api/v1/tenant-users/${id}`); },
};
