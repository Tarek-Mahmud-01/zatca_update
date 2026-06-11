"use client";

import { createCrudSlice } from "@/apps/redux-kit/crud";
import { tenantUsersApi } from "../services/users.api";
import type { TenantUser, InviteBody } from "../types/user.types";

// No generic update: role/branch edits use the dedicated endpoints and then
// `usersActions.upsertOne` the returned row.
export const usersCrud = createCrudSlice<TenantUser, InviteBody, never>("tenantUsers", {
  list:   (t) => tenantUsersApi.listTenantUsers(t),
  create: (t, b) => tenantUsersApi.inviteTenantUser(t, b),
  remove: (t, id) => tenantUsersApi.removeTenantUser(t, id),
});

export const usersReducer = usersCrud.reducer;
export const usersActions = usersCrud.actions;
export const usersAdapter = usersCrud.adapter;
