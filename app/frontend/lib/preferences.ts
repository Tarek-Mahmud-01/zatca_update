"use client";

import { useEffect, useState } from "react";

const KEY = "zatca.preferences";

export interface Preferences {
  /** Default page size for the Invoices list. */
  pageSize: 10 | 25 | 50 | 100;
  /** Soft daily target for reported (B2C) invoices. Surfaced on Overview. */
  reportedDailyQuota: number;
  /** Soft daily target for cleared (B2B) invoices. */
  clearanceDailyQuota: number;
}

export const DEFAULT_PREFERENCES: Preferences = {
  pageSize: 25,
  reportedDailyQuota: 500,
  clearanceDailyQuota: 100,
};

export function loadPreferences(): Preferences {
  if (typeof window === "undefined") return DEFAULT_PREFERENCES;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    const v = JSON.parse(raw) as Partial<Preferences>;
    return { ...DEFAULT_PREFERENCES, ...v };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function savePreferences(p: Preferences) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(p));
  window.dispatchEvent(new CustomEvent("preferencesChange", { detail: p }));
}

export function usePreferences(): [Preferences, (p: Preferences) => void] {
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFERENCES);

  useEffect(() => {
    setPrefs(loadPreferences());
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<Preferences>).detail;
      if (detail) setPrefs(detail);
    };
    window.addEventListener("preferencesChange", onChange);
    return () => window.removeEventListener("preferencesChange", onChange);
  }, []);

  return [prefs, (p) => { savePreferences(p); setPrefs(p); }];
}
