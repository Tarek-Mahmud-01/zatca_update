"use client";

import { useEffect, useState } from "react";
import {
  api,
  type QueueScheduleMode,
  type TenantSettings,
} from "../../../../lib/api-client";
import { getToken } from "../../../../lib/token";
import {
  DEFAULT_PREFERENCES, fetchPreferences, type Preferences,
} from "../../../../lib/preferences";
import { Card, Field, FieldGrid, PageHeader } from "../../../../components/ui";
import { pushNotification } from "../../../../lib/notifications";

const PAGE_SIZES = [10, 25, 50, 100] as const;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function normalizeTimes(times: string[]): string[] {
  const out = new Set<string>();
  for (const t of times) {
    const s = (t || "").trim();
    if (HHMM.test(s)) out.add(s);
  }
  return Array.from(out).sort();
}

function describeInterval(mins: number): string {
  if (mins <= 0) return "off";
  if (mins < 60) return `every ${mins} min`;
  if (mins % 60 === 0) {
    const h = mins / 60;
    if (h === 24) return "once a day";
    return `every ${h} hour${h === 1 ? "" : "s"}`;
  }
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `every ${h}h ${m}m`;
}

export default function PreferencesPage() {
  const [tenantSettings, setTenantSettings] = useState<TenantSettings | null>(null);
  const [strategy, setStrategy] = useState<"immediate" | "queued">("immediate");
  const [mode, setMode] = useState<QueueScheduleMode>("times");
  const [times, setTimes] = useState<string[]>([]);
  const [draftTime, setDraftTime] = useState("");
  const [intervalMinutes, setIntervalMinutes] = useState<number>(60);
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    fetchPreferences().then(setPrefs).catch(() => setPrefs(DEFAULT_PREFERENCES));
    api.getTenantSettings(token).then((s) => {
      // Defensive: an older backend (pre-0006) may omit the new fields.
      const normalized: TenantSettings = {
        queue_strategy: s.queue_strategy ?? "immediate",
        queue_schedule_mode: s.queue_schedule_mode ?? "times",
        queue_schedule_times: Array.isArray(s.queue_schedule_times)
          ? s.queue_schedule_times
          : ["09:00", "12:00", "15:00", "17:00", "19:00"],
        queue_schedule_interval_minutes:
          Number.isFinite(s.queue_schedule_interval_minutes)
            ? s.queue_schedule_interval_minutes
            : 60,
        queue_throttle_per_minute: s.queue_throttle_per_minute ?? 60,
      };
      setTenantSettings(normalized);
      setStrategy(normalized.queue_strategy);
      setMode(normalized.queue_schedule_mode);
      setTimes(normalizeTimes(normalized.queue_schedule_times));
      setIntervalMinutes(normalized.queue_schedule_interval_minutes);
    }).catch((e) => pushNotification({
      tone: "danger", title: "Couldn't load queue config", body: String(e),
    }));
  }, []);

  function addTime() {
    if (!HHMM.test(draftTime)) {
      pushNotification({
        tone: "danger", title: "Invalid time",
        body: "Use 24-hour HH:MM, e.g. 09:00, 13:30, 17:45.",
      });
      return;
    }
    setTimes((prev) => normalizeTimes([...prev, draftTime]));
    setDraftTime("");
  }

  function removeTime(t: string) {
    setTimes((prev) => prev.filter((x) => x !== t));
  }

  function applyTimesPreset(preset: string[]) {
    setTimes(normalizeTimes(preset));
  }

  async function saveStrategy(e: React.FormEvent) {
    e.preventDefault();
    const token = getToken();
    if (!token) return;
    const cleanTimes = normalizeTimes(times);
    if (mode === "times" && cleanTimes.length === 0) {
      pushNotification({
        tone: "danger", title: "At least one schedule time required",
        body: "Add one HH:MM time, switch to interval mode, or pick Immediate.",
      });
      return;
    }
    if (mode === "interval" && (intervalMinutes < 1 || intervalMinutes > 24 * 60)) {
      pushNotification({
        tone: "danger", title: "Interval out of range",
        body: "Interval must be between 1 minute and 24 hours (1440 min).",
      });
      return;
    }
    setBusy(true);
    try {
      const raw = await api.putTenantSettings(token, {
        queue_strategy: strategy,
        queue_schedule_mode: mode,
        queue_schedule_times: cleanTimes,
        queue_schedule_interval_minutes: intervalMinutes,
        queue_throttle_per_minute: tenantSettings?.queue_throttle_per_minute ?? 60,
      });
      // Normalize defensively — an older backend may omit the new fields,
      // so re-derive everything from what we sent.
      const next: TenantSettings = {
        queue_strategy: raw.queue_strategy ?? strategy,
        queue_schedule_mode: raw.queue_schedule_mode ?? mode,
        queue_schedule_times: Array.isArray(raw.queue_schedule_times)
          ? raw.queue_schedule_times
          : cleanTimes,
        queue_schedule_interval_minutes: Number.isFinite(raw.queue_schedule_interval_minutes)
          ? raw.queue_schedule_interval_minutes
          : intervalMinutes,
        queue_throttle_per_minute: raw.queue_throttle_per_minute
          ?? tenantSettings?.queue_throttle_per_minute ?? 60,
      };
      setTenantSettings(next);
      setTimes(normalizeTimes(next.queue_schedule_times));
      setIntervalMinutes(next.queue_schedule_interval_minutes);
      pushNotification({
        tone: "success", title: "Queue config saved",
        body: strategy === "immediate"
          ? "All new invoices will submit immediately."
          : (next.queue_schedule_mode === "interval"
              ? `Queue will release ${describeInterval(next.queue_schedule_interval_minutes)}.`
              : `Queue will release at ${next.queue_schedule_times.length} time(s) per day.`),
      });
    } catch (e) {
      pushNotification({ tone: "danger", title: "Save failed", body: String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function saveDisplay(e: React.FormEvent) {
    e.preventDefault();
    const token = getToken();
    if (!token) return;
    try {
      const res = await api.putUserPreferences(token, {
        page_size: prefs.pageSize,
        reported_daily_quota: prefs.reportedDailyQuota,
        clearance_daily_quota: prefs.clearanceDailyQuota,
      });
      setPrefs({
        pageSize: res.page_size,
        reportedDailyQuota: res.reported_daily_quota,
        clearanceDailyQuota: res.clearance_daily_quota,
        updatedAt: res.updated_at,
      });
      pushNotification({ tone: "success", title: "Display preferences saved" });
    } catch (e) {
      pushNotification({ tone: "danger", title: "Save failed", body: String(e) });
    }
  }

  return (
    <div>
      <PageHeader
        title="Preferences"
        description="Tenant-wide queue scheduling and per-browser display options."
      />

      {/* Queue scheduling — server-side per tenant */}
      <form onSubmit={saveStrategy} className="mb-6">
        <Card
          title="Queue scheduling"
          description="Tenant-wide. Each scheduled release drains the entire queue in one batch."
        >
          <div className="flex flex-col gap-5">
            <Field label="Submission strategy" required>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label
                  className={`p-3 border rounded-md cursor-pointer transition-colors ${
                    strategy === "immediate"
                      ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]"
                      : "border-[var(--color-border)] hover:bg-[var(--color-bg-hover)]"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="radio" name="strategy" value="immediate"
                      checked={strategy === "immediate"}
                      onChange={() => setStrategy("immediate")}
                    />
                    <span className="text-sm font-medium">Immediate</span>
                  </div>
                  <p className="text-xs text-[var(--color-fg-muted)] mt-1">
                    Every submitted invoice is signed and pushed to ZATCA right away.
                  </p>
                </label>
                <label
                  className={`p-3 border rounded-md cursor-pointer transition-colors ${
                    strategy === "queued"
                      ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]"
                      : "border-[var(--color-border)] hover:bg-[var(--color-bg-hover)]"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="radio" name="strategy" value="queued"
                      checked={strategy === "queued"}
                      onChange={() => setStrategy("queued")}
                    />
                    <span className="text-sm font-medium">Queued (batched)</span>
                  </div>
                  <p className="text-xs text-[var(--color-fg-muted)] mt-1">
                    Sign + persist immediately, but hold off submission until the
                    next scheduled release below.
                  </p>
                </label>
              </div>
            </Field>

            {/* Schedule mode tabs — only relevant when strategy = queued */}
            <fieldset
              disabled={strategy !== "queued"}
              className={`flex flex-col gap-4 transition-opacity ${strategy === "queued" ? "" : "opacity-50"}`}
            >
              <Field label="Schedule mode">
                <div className="inline-flex rounded-md border border-[var(--color-border)] overflow-hidden text-sm w-fit">
                  <button
                    type="button"
                    onClick={() => setMode("times")}
                    className={`px-4 py-1.5 transition-colors ${
                      mode === "times"
                        ? "bg-[var(--color-accent)] text-white"
                        : "bg-white text-[var(--color-fg-2)] hover:bg-[var(--color-bg-hover)]"
                    }`}
                  >
                    Specific times
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("interval")}
                    className={`px-4 py-1.5 transition-colors border-l border-[var(--color-border)] ${
                      mode === "interval"
                        ? "bg-[var(--color-accent)] text-white"
                        : "bg-white text-[var(--color-fg-2)] hover:bg-[var(--color-bg-hover)]"
                    }`}
                  >
                    Every N minutes / hours
                  </button>
                </div>
              </Field>

              {mode === "times" && (
                <Field
                  label="Daily release schedule (UTC, 24h)"
                  hint="At every listed time the worker drains every queued invoice in one batch."
                >
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-center gap-2 min-h-[28px]">
                      {times.length === 0 && (
                        <span className="text-xs text-[var(--color-fg-muted)]">
                          No times set — the queue will never auto-release.
                        </span>
                      )}
                      {times.map((t) => (
                        <span
                          key={t}
                          className="chip inline-flex items-center gap-1.5 tabular-nums"
                        >
                          {t}
                          <button
                            type="button"
                            onClick={() => removeTime(t)}
                            aria-label={`Remove ${t}`}
                            className="ml-1 -mr-1 px-1 rounded hover:bg-black/5 text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>

                    <div className="flex flex-wrap items-end gap-2">
                      <input
                        type="time"
                        className="input tabular-nums"
                        value={draftTime}
                        onChange={(e) => setDraftTime(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addTime();
                          }
                        }}
                        step={60}
                        style={{ width: 130 }}
                      />
                      <button type="button" className="btn btn-default" onClick={addTime}>
                        Add time
                      </button>
                      <span className="text-xs text-[var(--color-fg-muted)] ml-1">presets:</span>
                      <button
                        type="button"
                        className="text-xs underline text-[var(--color-fg-2)] hover:text-[var(--color-fg)]"
                        onClick={() => applyTimesPreset(["09:00", "13:00", "17:00"])}
                      >
                        3×/day
                      </button>
                      <button
                        type="button"
                        className="text-xs underline text-[var(--color-fg-2)] hover:text-[var(--color-fg)]"
                        onClick={() => applyTimesPreset(["09:00", "12:00", "15:00", "17:00", "19:00"])}
                      >
                        5×/day
                      </button>
                      <button
                        type="button"
                        className="text-xs underline text-[var(--color-fg-2)] hover:text-[var(--color-fg)]"
                        onClick={() => applyTimesPreset(["08:00", "11:00", "13:00", "15:00", "17:00", "19:00", "21:00"])}
                      >
                        7×/day
                      </button>
                    </div>
                  </div>
                </Field>
              )}

              {mode === "interval" && (
                <Field
                  label="Release interval"
                  hint="Anchored at 00:00 UTC. 'Every 60 minutes' fires at HH:00 each hour."
                >
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="number"
                        className="input tabular-nums"
                        style={{ width: 100 }}
                        min={1}
                        max={24 * 60}
                        value={intervalMinutes}
                        onChange={(e) =>
                          setIntervalMinutes(Math.max(1, Math.min(24 * 60, Number(e.target.value) || 1)))
                        }
                      />
                      <span className="text-sm text-[var(--color-fg-2)]">minutes</span>
                      <span className="text-xs text-[var(--color-fg-muted)] ml-1">
                        ≈ <span className="tabular-nums">{describeInterval(intervalMinutes)}</span>
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-1.5 text-xs">
                      <span className="text-[var(--color-fg-muted)] mr-1 mt-0.5">presets:</span>
                      {[
                        { label: "1 min",  m: 1 },
                        { label: "5 min",  m: 5 },
                        { label: "15 min", m: 15 },
                        { label: "30 min", m: 30 },
                        { label: "1 hour", m: 60 },
                        { label: "2 hours", m: 120 },
                        { label: "4 hours", m: 240 },
                        { label: "6 hours", m: 360 },
                        { label: "12 hours", m: 720 },
                        { label: "Daily",  m: 1440 },
                      ].map((p) => (
                        <button
                          key={p.m}
                          type="button"
                          onClick={() => setIntervalMinutes(p.m)}
                          className={`px-2 py-0.5 rounded border transition-colors ${
                            intervalMinutes === p.m
                              ? "bg-[var(--color-accent-soft)] border-[var(--color-accent)] text-[var(--color-accent-hover)] font-medium"
                              : "bg-white border-[var(--color-border)] text-[var(--color-fg-2)] hover:bg-[var(--color-bg-hover)]"
                          }`}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </Field>
              )}
            </fieldset>

            <div className="flex gap-2">
              <button className="btn btn-primary" disabled={busy} type="submit">
                {busy ? "Saving…" : "Save queue config"}
              </button>
            </div>

            <div className="text-xs text-[var(--color-fg-muted)] mt-2">
              Effective config:{" "}
              <code>{tenantSettings?.queue_strategy ?? "…"}</code>
              {tenantSettings?.queue_strategy === "queued" && (
                <>
                  {" · "}
                  <code>{tenantSettings.queue_schedule_mode ?? "times"}</code>
                  {" · "}
                  {(tenantSettings.queue_schedule_mode ?? "times") === "interval"
                    ? <code>{describeInterval(tenantSettings.queue_schedule_interval_minutes ?? 60)}</code>
                    : ((tenantSettings.queue_schedule_times ?? []).length > 0
                        ? <>at <code>{(tenantSettings.queue_schedule_times ?? []).join(", ")}</code> UTC</>
                        : <>no schedule</>)}
                </>
              )}
            </div>
          </div>
        </Card>
      </form>

      {/* Display — per browser */}
      <form onSubmit={saveDisplay}>
        <Card title="Display" description="Stored per browser. Affects only your session.">
          <FieldGrid cols={2}>
            <Field label="Default page size" hint="Number of rows per page on the Invoices list.">
              <select
                className="input"
                value={prefs.pageSize}
                onChange={(e) => setPrefs({ ...prefs, pageSize: Number(e.target.value) as Preferences["pageSize"] })}
              >
                {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </Field>
          </FieldGrid>
          <div className="mt-4">
            <button className="btn btn-default" type="submit">Save display</button>
          </div>
        </Card>
      </form>
    </div>
  );
}
