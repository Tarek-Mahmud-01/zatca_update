"use client";

// Cross-tab auth-expiry channel. When any tab calls handleAuthExpired() it
// posts to this channel; every other open tab in the same origin receives
// the message and bounces to /login immediately — no polling, no race.
// `subscribeAuthExpired` is mounted once in the dashboard layout.
const AUTH_CHANNEL = "zatca-auth";

function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  return new BroadcastChannel(AUTH_CHANNEL);
}

export function getToken(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|;\s*)token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Decode the JWT payload without verifying the signature — we only use this
 * to read the `exp` claim for an upfront client-side liveness check, so we
 * don't have to hit /auth/me on every page render to know if the token is
 * dead. The SSE stream is still the source of truth for server-side
 * revocations and runtime invalidation.
 *
 * Returns null when the token is malformed.
 */
export function decodeJwtPayload(token: string): { exp?: number; sub?: string } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = "=".repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(atob(b64 + pad));
  } catch { return null; }
}

/** True iff a token is present AND its `exp` claim is in the future. */
export function isTokenLive(): boolean {
  const t = getToken();
  if (!t) return false;
  const payload = decodeJwtPayload(t);
  if (!payload || typeof payload.exp !== "number") return false;
  return payload.exp * 1000 > Date.now();
}

/** Wipe the token cookie. Called when the server tells us auth is invalid. */
export function clearToken(): void {
  if (typeof document === "undefined") return;
  document.cookie = "token=; Path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
}

/**
 * Token expired / invalid handler. Single source of truth for auth-failure
 * response in *this* tab: wipe the cookie, broadcast to other tabs, then
 * redirect to /login (preserving the current URL so we can return after
 * re-auth). Safe to call from any event handler — bails if already on the
 * login page.
 *
 * Pass `broadcast=false` when this call was itself triggered by an incoming
 * broadcast — prevents an infinite ping-pong between tabs.
 */
export function handleAuthExpired(broadcast = true): void {
  if (typeof window === "undefined") return;
  if (window.location.pathname.startsWith("/login")) return;
  clearToken();
  if (broadcast) {
    const ch = getChannel();
    if (ch) { ch.postMessage({ type: "logout" }); ch.close(); }
  }
  const next = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.replace(`/login?next=${next}`);
}

/**
 * Listen for auth-expired broadcasts from sibling tabs. Returns a cleanup
 * function. Mount this once at the dashboard layout level — when another
 * tab logs out (or its session expires), this tab redirects immediately.
 */
export function subscribeAuthExpired(): () => void {
  const ch = getChannel();
  if (!ch) return () => {};
  function onMessage(ev: MessageEvent) {
    if (ev.data?.type === "logout") handleAuthExpired(false);
  }
  ch.addEventListener("message", onMessage);
  return () => {
    ch.removeEventListener("message", onMessage);
    ch.close();
  };
}
