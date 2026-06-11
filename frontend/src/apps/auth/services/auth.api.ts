/**
 * Auth feature API — the only consumers of POST /auth/login and POST
 * /auth/signup, so both live here rather than in the shared layer. Shared auth
 * types come from @/apps/auth/services/auth.
 */
import { request } from "@/apps/http/client";
import type { TokenResponse } from "@/apps/auth/services/auth";

export const loginApi = {
  async login(email: string, password: string, rememberMe = false): Promise<TokenResponse> {
    return request<TokenResponse>("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password, remember_me: rememberMe }),
    });
  },
};

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
