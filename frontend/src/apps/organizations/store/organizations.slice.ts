"use client";

import { createCrudSlice } from "@/apps/redux-kit/crud";
import { organizationsApi } from "../services/organizations.api";
import type { TenantOrganization } from "../types/organization.types";

export const organizationsCrud = createCrudSlice<TenantOrganization>("organizations", {
  list:   (t) => organizationsApi.listOrganizations(t),
  create: (t, b) => organizationsApi.createOrganization(t, b),
  update: (t, id, b) => organizationsApi.updateOrganization(t, id, b),
  remove: (t, id) => organizationsApi.deleteOrganization(t, id),
});

export const organizationsReducer = organizationsCrud.reducer;
export const organizationsActions = organizationsCrud.actions;
export const organizationsAdapter = organizationsCrud.adapter;
