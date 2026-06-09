"use client";

/**
 * Team members (tenant users) store slice + subscription hook (feature-owned).
 * No update thunk — role/branch edits use the dedicated endpoints and then
 * `tenantUsers.actions.upsertOne` the returned row.
 */
import { createCrudSlice } from "@/lib/store/crud";
import { makeEntityHook } from "@/lib/store/make-entity-hook";
import type { RootState } from "@/lib/store";
import { tenantUsersApi, type TenantUser } from "./_api";

type InviteBody = { email: string; password: string; role: string; default_branch_id?: string | null };

export const tenantUsers = createCrudSlice<TenantUser, InviteBody, never>("tenantUsers", {
  list:   (t) => tenantUsersApi.listTenantUsers(t),
  create: (t, b) => tenantUsersApi.inviteTenantUser(t, b),
  remove: (t, id) => tenantUsersApi.removeTenantUser(t, id),
});

const sel = tenantUsers.adapter.getSelectors((s: RootState) => s.tenantUsers);
export const useTenantUsers = makeEntityHook(sel.selectAll, "tenantUsers", tenantUsers.thunks.fetchAll);
