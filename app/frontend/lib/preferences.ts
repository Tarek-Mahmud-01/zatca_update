"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type UserPreferences, type UserPreferencesUpdate } from "./api-client";
import { getToken } from "./token";

/**
 * Per-user UI preferences (page size, soft daily quotas).
 *
 * Source of truth is the backend (`tenant_users` row scoped to the current
 * `user_id`). We deliberately do NOT mirror these to localStorage — that
 * caused multi-device drift and made the architecture rely on browser state
 * as the source of truth.
 *
 * - First mount: fetch from the API. Until that lands, return DEFAULT_PREFERENCES.
 * - On save: PUT to the API. The backend response replaces local React state.
 *   Other tabs subscribe via the cross-tab event so they reflect the change
 *   without a network round-trip.
 * - On preferencesChange event (cross-tab): re-render with the new values.
 *
 * Cache invalidation: we tag every fetched value with the server's
 * ``updated_at`` so callers (and tests) can detect outdated reads.
 */
export interface Preferences {
  pageSize: 10 | 25 | 50 | 100;
  reportedDailyQuota: number;
  clearanceDailyQuota: number;
  /** Server-side updated_at (ISO). "" until first fetch. */
  updatedAt: string;
}

export const DEFAULT_PREFERENCES: Preferences = {
  pageSize: 25,
  reportedDailyQuota: 500,
  clearanceDailyQuota: 100,
  updatedAt: "",
};

const CHANNEL = "zatca-preferences";

// One-time cleanup: remove the legacy localStorage key from the old build,
// so it can't be mistaken for the source of truth in DevTools/audits. Safe
// to call repeatedly — it's a no-op once the key is gone.
function clearLegacyLocalStorage(): void {
  if (typeof window === "undefined") return;
  try {
    if (window.localStorage.getItem("zatca.preferences") !== null) {
      window.localStorage.removeItem("zatca.preferences");
    }
  } catch { /* ignore */ }
}

function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  return new BroadcastChannel(CHANNEL);
}

function fromApi(p: UserPreferences): Preferences {
  return {
    pageSize: p.page_size,
    reportedDailyQuota: p.reported_daily_quota,
    clearanceDailyQuota: p.clearance_daily_quota,
    updatedAt: p.updated_at,
  };
}

function toApi(p: Partial<Preferences>): Partial<UserPreferencesUpdate> {
  const out: Partial<UserPreferencesUpdate> = {};
  if (p.pageSize !== undefined) out.page_size = p.pageSize;
  if (p.reportedDailyQuota !== undefined) out.reported_daily_quota = p.reportedDailyQuota;
  if (p.clearanceDailyQuota !== undefined) out.clearance_daily_quota = p.clearanceDailyQuota;
  return out;
}

/**
 * Reactive accessor. Returns [prefs, save]:
 *   - prefs always reflects the latest known server state for this user.
 *   - save(patch) sends the partial update to the backend and broadcasts
 *     the new values to other tabs.
 */
export function usePreferences(): [Preferences, (patch: Partial<Preferences>) => Promise<void>] {
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFERENCES);

  // Initial fetch + cross-tab subscription.
  useEffect(() => {
    clearLegacyLocalStorage();
    let cancelled = false;
    const token = getToken();
    if (token) {
      api.getUserPreferences(token)
        .then((p) => { if (!cancelled) setPrefs(fromApi(p)); })
        .catch(() => { /* leave defaults */ });
    }
    const ch = getChannel();
    function onMessage(ev: MessageEvent) {
      const next = ev.data as Preferences | undefined;
      if (next) setPrefs(next);
    }
    ch?.addEventListener("message", onMessage);
    return () => {
      cancelled = true;
      ch?.removeEventListener("message", onMessage);
      ch?.close();
    };
  }, []);

  const save = useCallback(async (patch: Partial<Preferences>) => {
    const token = getToken();
    if (!token) return;
    const res = await api.putUserPreferences(token, toApi(patch));
    const next = fromApi(res);
    setPrefs(next);
    // Notify other tabs of THIS user so they refresh without polling.
    const ch = getChannel();
    if (ch) { ch.postMessage(next); ch.close(); }
  }, []);

  return [prefs, save];
}

/**
 * One-shot accessor for non-React code (e.g. AutoQueueTick). Always hits the
 * API — never returns stale local state. Use sparingly; pages should prefer
 * usePreferences().
 */
export async function fetchPreferences(): Promise<Preferences> {
  clearLegacyLocalStorage();
  const token = getToken();
  if (!token) return DEFAULT_PREFERENCES;
  try {
    return fromApi(await api.getUserPreferences(token));
  } catch {
    return DEFAULT_PREFERENCES;
  }
}
