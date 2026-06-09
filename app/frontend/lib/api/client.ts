/**
 * Shared API transport — used by EVERY feature's `_api.ts` and by the shared
 * domain modules in this folder. Holds nothing feature-specific: just the base
 * URL, the `request()` helper (auth header + centralised 401 handling), and a
 * `del()` helper for the repeated DELETE pattern.
 */

// 127.0.0.1 (not "localhost") — uvicorn binds IPv4-only and Windows resolves
// "localhost" to IPv6 ::1 first, causing "Failed to fetch". Override with
// BACKEND_URL in the environment if your backend is elsewhere.
export const BACKEND = process.env.BACKEND_URL ?? "http://127.0.0.1:8001";

export async function request<T>(
  path: string,
  init: RequestInit & { token?: string | null } = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.token) headers.set("Authorization", `Bearer ${init.token}`);
  if (!(init.body instanceof FormData) && init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(`${BACKEND}${path}`, { ...init, headers });
  if (!res.ok) {
    // Centralised auth-expired handling. Any 401 (and 403 on /me, which
    // means the JWT is no longer valid) wipes the cookie and bounces to
    // /login. Skip the login endpoint itself so a wrong-password error
    // stays visible on the form instead of bouncing.
    const isLoginEndpoint = path.startsWith("/api/v1/auth/login");
    if (!isLoginEndpoint && (res.status === 401 || (res.status === 403 && path.includes("/auth/me")))) {
      const { handleAuthExpired } = await import("../token");
      handleAuthExpired();
      throw new Error("auth_expired");
    }
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

/** DELETE that tolerates 200 or 204 and throws on anything else. */
export async function del(token: string, path: string): Promise<void> {
  const res = await fetch(`${BACKEND}${path}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 204) throw new Error(`API ${res.status}: ${await res.text()}`);
}
