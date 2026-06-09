/**
 * Login feature API — the only consumer of POST /auth/login, so it lives here
 * rather than in the shared layer. Shared auth types come from @/lib/api/auth.
 */
import { request } from "@/lib/api/client";
import type { TokenResponse } from "@/lib/api/auth";

export const loginApi = {
  async login(email: string, password: string): Promise<TokenResponse> {
    const form = new FormData();
    form.append("username", email);
    form.append("password", password);
    return request<TokenResponse>("/api/v1/auth/login", { method: "POST", body: form });
  },
};
