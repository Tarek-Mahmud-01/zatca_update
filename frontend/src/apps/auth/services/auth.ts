/**
 * Auth domain (shared). `me()` is consumed by the session store (used app-wide
 * via useMe), and the token/profile types are shared by the login & signup
 * features. The login/signup CALLS themselves are feature-local (see
 * app/login/_api.ts, app/signup/_api.ts).
 */
import { request } from "@/apps/http/client";

export interface TokenResponse {
  access_token: string;
  token_type: "bearer";
}

export interface Me {
  user_id: string;
  email: string;
  role: string;
  tenant_id: string;
  tenant_name: string;
  vat_number: string;
  organization_identifier: string;
  default_branch_id: string | null;
}

export const authApi = {
  me(token: string) { return request<Me>("/api/v1/auth/me", { token }); },
};
