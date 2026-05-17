"use client";

import { useEffect, useState } from "react";
import { api, type TenantSettings } from "../../../../lib/api-client";
import { getToken } from "../../../../lib/token";
import {
  DEFAULT_PREFERENCES, loadPreferences, savePreferences, type Preferences,
} from "../../../../lib/preferences";
import { Banner, Card, Field, FieldGrid, PageHeader } from "../../../../components/ui";

const PAGE_SIZES = [10, 25, 50, 100] as const;

export default function PreferencesPage() {
  const [tenantSettings, setTenantSettings] = useState<TenantSettings | null>(null);
  const [strategyEdit, setStrategyEdit] = useState<TenantSettings | null>(null);
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    setPrefs(loadPreferences());
    api.getTenantSettings(token).then((s) => {
      setTenantSettings(s);
      setStrategyEdit(s);
    }).catch((e) => setError(String(e)));
  }, []);

  async function saveStrategy(e: React.FormEvent) {
    e.preventDefault();
    const token = getToken();
    if (!token || !strategyEdit) return;
    setBusy(true);
    setError(null);
    try {
      const next = await api.putTenantSettings(token, strategyEdit);
      setTenantSettings(next);
      setStrategyEdit(next);
      setSavedAt("Queue strategy updated.");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  function saveDisplay(e: React.FormEvent) {
    e.preventDefault();
    savePreferences(prefs);
    setSavedAt("Display preferences saved.");
  }

  return (
    <div>
      <PageHeader
        title="Preferences"
        description="Tenant-wide queue scheduling and per-browser display options."
      />

      {error && <div className="mb-4"><Banner tone="danger">{error}</Banner></div>}
      {savedAt && <div className="mb-4"><Banner tone="success">{savedAt}</Banner></div>}

      {/* Queue scheduling — server-side per tenant */}
      <form onSubmit={saveStrategy} className="mb-6">
        <Card
          title="Queue scheduling"
          description="Tenant-wide. Controls how the worker releases invoices to ZATCA."
        >
          {strategyEdit ? (
            <div className="flex flex-col gap-5">
              <Field label="Submission strategy" required>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label
                    className={`p-3 border rounded-md cursor-pointer transition-colors ${
                      strategyEdit.queue_strategy === "immediate"
                        ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]"
                        : "border-[var(--color-border)] hover:bg-[var(--color-bg-hover)]"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="radio" name="strategy" value="immediate"
                        checked={strategyEdit.queue_strategy === "immediate"}
                        onChange={() => setStrategyEdit({ ...strategyEdit, queue_strategy: "immediate" })}
                      />
                      <span className="text-sm font-medium">Immediate</span>
                    </div>
                    <p className="text-xs text-[var(--color-fg-muted)] mt-1">
                      Every submitted invoice is signed and pushed to ZATCA right away.
                    </p>
                  </label>
                  <label
                    className={`p-3 border rounded-md cursor-pointer transition-colors ${
                      strategyEdit.queue_strategy === "queued"
                        ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]"
                        : "border-[var(--color-border)] hover:bg-[var(--color-bg-hover)]"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="radio" name="strategy" value="queued"
                        checked={strategyEdit.queue_strategy === "queued"}
                        onChange={() => setStrategyEdit({ ...strategyEdit, queue_strategy: "queued" })}
                      />
                      <span className="text-sm font-medium">Queued (batched)</span>
                    </div>
                    <p className="text-xs text-[var(--color-fg-muted)] mt-1">
                      Sign + persist immediately, but hold off submission. Released later via the
                      &quot;Process queue&quot; action up to the throttle.
                    </p>
                  </label>
                </div>
              </Field>

              <FieldGrid cols={2}>
                <Field
                  label="Throttle — invoices per minute"
                  hint="Cap on how many queued invoices the worker releases per Process-queue tick."
                >
                  <input
                    className="input tabular-nums"
                    type="number" min={1} max={10000}
                    value={strategyEdit.queue_throttle_per_minute}
                    onChange={(e) => setStrategyEdit({
                      ...strategyEdit,
                      queue_throttle_per_minute: Math.max(1, Number(e.target.value) || 1),
                    })}
                  />
                </Field>
              </FieldGrid>

              <div className="flex gap-2">
                <button className="btn btn-primary" disabled={busy} type="submit">
                  {busy ? "Saving…" : "Save queue config"}
                </button>
              </div>

              <div className="text-xs text-[var(--color-fg-muted)] mt-2">
                Effective config:{" "}
                <code>{tenantSettings?.queue_strategy}</code> ·{" "}
                <code>{tenantSettings?.queue_throttle_per_minute}</code>/min
              </div>
            </div>
          ) : (
            <p className="muted">Loading…</p>
          )}
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
