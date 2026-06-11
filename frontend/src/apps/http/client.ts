/**
 * Shared API transport — plain JSON over HTTPS with Bearer token auth.
 * TLS handles transit encryption; JWT handles auth. No application-layer
 * encryption overhead.
 */

export const BACKEND = process.env.BACKEND_URL ?? "http://127.0.0.1:8011";

export async function request<T>(
  path: string,
  init: RequestInit & { token?: string | null } = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.token) headers.set("Authorization", `Bearer ${init.token}`);
  if (typeof init.body === "string") headers.set("Content-Type", "application/json");

  const res = await fetch(`${BACKEND}${path}`, { ...init, headers });

  if (!res.ok) {
    const isLogin = path.startsWith("/api/v1/auth/login");
    if (!isLogin && (res.status === 401 || (res.status === 403 && path.includes("/auth/me")))) {
      const { handleAuthExpired } = await import("@/apps/auth/utils/token");
      handleAuthExpired();
      throw new Error("auth_expired");
    }
    throw new Error(`API ${res.status}: ${await res.text()}`);
  }

  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

/** DELETE helper — tolerates 200 or 204, throws on anything else. */
export async function del(token: string, path: string): Promise<void> {
  const res = await fetch(`${BACKEND}${path}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 204) throw new Error(`API ${res.status}: ${await res.text()}`);
}
