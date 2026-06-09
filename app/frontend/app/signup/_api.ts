/**
 * Signup feature API — the only consumer of POST /auth/signup. Shared auth
 * types come from @/lib/api/auth.
 */
import { request } from "@/lib/api/client";
import type { TokenResponse } from "@/lib/api/auth";

export const signupApi = {
  async signup(body: {
    tenant_name: string;
    vat_number: string;
    organization_identifier: string;
    email: string;
    password: string;
  }): Promise<TokenResponse> {
    return request<TokenResponse>("/api/v1/auth/signup", { method: "POST", body: JSON.stringify(body) });
  },
};
