/**
 * Cross-cutting settings domain (shared): per-user UI preferences and the
 * tenant-wide queue settings. Consumed by the shared preferences provider
 * (lib/preferences.ts), the Preferences page, and the invoice editor (which
 * reads the queue strategy). Not owned by a single feature → shared.
 */
import { request } from "./client";

export type QueueScheduleMode = "times" | "interval";

export interface UserPreferences {
  page_size: 10 | 25 | 50 | 100;
  reported_daily_quota: number;
  clearance_daily_quota: number;
  updated_at: string;  // ISO timestamp — for cache invalidation / change detection
}

export interface UserPreferencesUpdate {
  page_size: 10 | 25 | 50 | 100;
  reported_daily_quota: number;
  clearance_daily_quota: number;
}

export interface TenantSettings {
  queue_strategy: "immediate" | "queued";
  queue_schedule_mode: QueueScheduleMode;
  // Used when mode = "times". List of "HH:MM" (UTC) release times.
  queue_schedule_times: string[];
  // Used when mode = "interval". Minutes between releases, anchored at midnight UTC.
  queue_schedule_interval_minutes: number;
  // Legacy throttle. Server still returns it but ignores it for the new model.
  queue_throttle_per_minute: number;
}

export const settingsApi = {
  // ---- Per-user UI preferences (page size, soft daily quotas) ----
  // Source of truth lives on the backend (`tenant_users` row scoped to user_id).
  // Frontend NEVER persists these in localStorage.
  getUserPreferences(token: string) {
    return request<UserPreferences>("/api/v1/settings/user-preferences", { token });
  },
  putUserPreferences(token: string, body: Partial<UserPreferencesUpdate>) {
    return request<UserPreferences>("/api/v1/settings/user-preferences", {
      method: "PUT", body: JSON.stringify(body), token,
    });
  },

  // ---- Tenant queue settings ----
  getTenantSettings(token: string) {
    return request<TenantSettings>("/api/v1/settings/tenant", { token });
  },
  putTenantSettings(
    token: string,
    body: {
      queue_strategy: "immediate" | "queued";
      queue_schedule_mode: QueueScheduleMode;
      queue_schedule_times: string[];
      queue_schedule_interval_minutes: number;
      queue_throttle_per_minute: number;
    },
  ) {
    return request<TenantSettings>("/api/v1/settings/tenant", {
      method: "PUT", body: JSON.stringify(body), token,
    });
  },
};
