/**
 * Shared API transport — plain JSON with Bearer token auth.
 * Exception: the login request body is ECDH-encrypted so the password
 * is never sent in cleartext even over plain HTTP in dev.
 */
import { decryptBody, encryptBody, initCrypto } from "@/apps/http/crypto";

export const BACKEND = process.env.BACKEND_URL ?? "http://127.0.0.1:8011";

export async function request<T>(
  path: string,
  init: RequestInit & { token?: string | null } = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.token) headers.set("Authorization", `Bearer ${init.token}`);

  let body = init.body;
  const isLogin = path === "/api/v1/auth/login";

  if (isLogin && typeof body === "string") {
    // Encrypt only the login credentials
    const { clientPubkeyB64 } = await initCrypto();
    headers.set("X-Client-Pubkey", clientPubkeyB64);
    headers.set("X-Encrypted", "1");
    headers.set("Content-Type", "application/json");
    const { body: encBody } = await encryptBody(body);
    body = encBody;
  } else if (typeof body === "string") {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${BACKEND}${path}`, { ...init, headers, body });

  if (!res.ok) {
    if (!isLogin && (res.status === 401 || (res.status === 403 && path.includes("/auth/me")))) {
      const { handleAuthExpired } = await import("@/apps/auth/utils/token");
      handleAuthExpired();
      throw new Error("auth_expired");
    }
    const text = await res.text();
    let detail = text;
    if (res.headers.get("X-Encrypted") === "1") {
      try { detail = await decryptBody(text); } catch { /* use raw */ }
    }
    throw new Error(`API ${res.status}: ${detail}`);
  }

  const text = await res.text();
  if (!text) return undefined as T;
  if (res.headers.get("X-Encrypted") === "1") {
    return JSON.parse(await decryptBody(text)) as T;
  }
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
