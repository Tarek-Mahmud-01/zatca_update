/**
 * Transitional barrel / facade.
 *
 * The API used to live as one giant object here. It now lives in feature-owned
 * `_api.ts` files (app/<feature>/_api.ts), with only generic infra shared in
 * lib/api/* (the request() transport, auth `me`, the live-events stream, and
 * the cross-cutting settings domain). This barrel re-exports every type and
 * re-assembles the same `api` object so existing
 * `import { api, type X } from "@/lib/api-client"` call sites keep working
 * while they migrate to direct feature/domain imports.
 *
 * Prefer importing from the owning module directly in new code:
 *   import { invoicesApi } from "@/app/dashboard/invoices/_api";
 *   import { customersApi, type Customer } from "@/app/dashboard/customers/_api";
 */

// ---- shared infra (request transport + cross-cutting domains) --------------
export * from "./api/client";
export * from "./api/auth";
export * from "./api/events";
export * from "./api/settings";

// ---- feature-owned API modules ---------------------------------------------
export * from "@/app/login/_api";
export * from "@/app/signup/_api";
export * from "@/app/dashboard/onboarding/_api";
export * from "@/app/dashboard/invoices/_api";
export * from "@/app/dashboard/customers/_api";
export * from "@/app/dashboard/products/_api";
export * from "@/app/dashboard/categories/_api";
export * from "@/app/dashboard/settings/business/_api";
export * from "@/app/dashboard/settings/currencies/_api";
export * from "@/app/dashboard/settings/organizations/_api";
export * from "@/app/dashboard/settings/branches/_api";
export * from "@/app/dashboard/settings/users/_api";

import { authApi } from "./api/auth";
import { eventsApi } from "./api/events";
import { settingsApi } from "./api/settings";
import { loginApi } from "@/app/login/_api";
import { signupApi } from "@/app/signup/_api";
import { onboardingApi } from "@/app/dashboard/onboarding/_api";
import { invoicesApi } from "@/app/dashboard/invoices/_api";
import { customersApi } from "@/app/dashboard/customers/_api";
import { productsApi } from "@/app/dashboard/products/_api";
import { categoriesApi } from "@/app/dashboard/categories/_api";
import { businessApi } from "@/app/dashboard/settings/business/_api";
import { currenciesApi } from "@/app/dashboard/settings/currencies/_api";
import { organizationsApi } from "@/app/dashboard/settings/organizations/_api";
import { branchesApi } from "@/app/dashboard/settings/branches/_api";
import { tenantUsersApi } from "@/app/dashboard/settings/users/_api";

/**
 * Aggregated facade — identical surface to the original `api` object, composed
 * from the feature/domain modules above.
 */
export const api = {
  ...authApi,
  ...eventsApi,
  ...settingsApi,
  ...loginApi,
  ...signupApi,
  ...onboardingApi,
  ...invoicesApi,
  ...customersApi,
  ...productsApi,
  ...categoriesApi,
  ...businessApi,
  ...currenciesApi,
  ...organizationsApi,
  ...branchesApi,
  ...tenantUsersApi,
};
