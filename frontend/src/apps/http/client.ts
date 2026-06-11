/**
 * Shared API transport with ECDH + AES-256-GCM payload encryption.
 *
 * Every request carries X-Encrypted: 1 and X-Client-Pubkey so the server
 * can derive the same AES key and encrypt its response. Request bodies (JSON
 * strings) are encrypted client-side before sending; responses with X-Encrypted
 * header are decrypted before being parsed and returned.
 */
import { decryptBody, encryptBody, initCrypto } from "@/apps/http/crypto";

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

  // Initialise the ECDH session (cached after first call) to get the client pubkey
  const { clientPubkeyB64 } = await initCrypto();
  headers.set("X-Client-Pubkey", clientPubkeyB64);
  headers.set("X-Encrypted", "1");

  let body = init.body;

  // Encrypt JSON string bodies
  if (typeof body === "string") {
    const { body: encBody } = await encryptBody(body);
    headers.set("Content-Type", "application/json");
    body = encBody;
  } else if (body instanceof FormData) {
    // FormData (file uploads etc.) is passed through — response still encrypted
  } else if (body) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${BACKEND}${path}`, { ...init, headers, body });

  const isLoginEndpoint = path.startsWith("/api/v1/auth/login");

  if (!res.ok) {
    if (!isLoginEndpoint && (res.status === 401 || (res.status === 403 && path.includes("/auth/me")))) {
      const { handleAuthExpired } = await import("@/apps/auth/utils/token");
      handleAuthExpired();
      throw new Error("auth_expired");
    }
    const text = await res.text();
    // Try to decrypt an error envelope
    let detail = text;
    if (res.headers.get("X-Encrypted") === "1") {
      try { detail = await decryptBody(text); } catch { /* use raw text */ }
    }
    throw new Error(`API ${res.status}: ${detail}`);
  }

  const text = await res.text();
  if (!text) return undefined as T;

  if (res.headers.get("X-Encrypted") === "1") {
    const plain = await decryptBody(text);
    return JSON.parse(plain) as T;
  }
  return JSON.parse(text) as T;
}

/** DELETE that tolerates 200 or 204 and throws on anything else. */
export async function del(token: string, path: string): Promise<void> {
  const { clientPubkeyB64 } = await initCrypto();
  const res = await fetch(`${BACKEND}${path}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Encrypted": "1",
      "X-Client-Pubkey": clientPubkeyB64,
    },
  });
  if (!res.ok && res.status !== 204) throw new Error(`API ${res.status}: ${await res.text()}`);
}
