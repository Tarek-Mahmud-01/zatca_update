"use client";

import { organizationsAdapter } from "./organizations.slice";
import type { OrganizationsRootState } from "./organizations.store";

export const organizationSelectors = organizationsAdapter.getSelectors(
  (s: OrganizationsRootState) => s.organizations,
);
