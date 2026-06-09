"use client";

/**
 * Organizations store slice + subscription hook (feature-owned). The branches
 * page and the invoice editor import `useOrganizations` / `organizations` here.
 */
import { createCrudSlice } from "@/lib/store/crud";
import { makeEntityHook } from "@/lib/store/make-entity-hook";
import type { RootState } from "@/lib/store";
import { organizationsApi, type TenantOrganization } from "./_api";

export const organizations = createCrudSlice<TenantOrganization>("organizations", {
  list:   (t) => organizationsApi.listOrganizations(t),
  create: (t, b) => organizationsApi.createOrganization(t, b),
  update: (t, id, b) => organizationsApi.updateOrganization(t, id, b),
  remove: (t, id) => organizationsApi.deleteOrganization(t, id),
});

const sel = organizations.adapter.getSelectors((s: RootState) => s.organizations);
export const useOrganizations = makeEntityHook(sel.selectAll, "organizations", organizations.thunks.fetchAll);
