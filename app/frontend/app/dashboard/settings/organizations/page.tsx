"use client";

import { useEffect, useState } from "react";
import {
  api,
  type Me,
  type TenantOrganization,
} from "../../../../lib/api-client";
import { getToken } from "../../../../lib/token";
import { Banner, Card, Field, FieldGrid, PageHeader } from "../../../../components/ui";
import { pushNotification } from "../../../../lib/notifications";

export default function OrganizationsSettingsPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [organizations, setOrganizations] = useState<TenantOrganization[]>([]);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const isAdmin = me?.role === "admin";

  async function refresh() {
    const token = getToken();
    if (!token) return;
    try {
      const [m, orgs] = await Promise.all([api.me(token), api.listOrganizations(token)]);
      setMe(m);
      setOrganizations(orgs);
    } catch (e) {
      pushNotification({ tone: "danger", title: "Couldn't load organizations", body: String(e) });
    }
  }
  useEffect(() => { refresh(); }, []);

  async function create(v: Partial<TenantOrganization>) {
    const token = getToken();
    if (!token) return;
    setBusy(true);
    try {
      await api.createOrganization(token, v);
      setAdding(false);
      await refresh();
    } catch (e) {
      pushNotification({ tone: "danger", title: "Create failed", body: String(e) });
    } finally { setBusy(false); }
  }

  async function update(id: string, v: Partial<TenantOrganization>) {
    const token = getToken();
    if (!token) return;
    setBusy(true);
    try {
      await api.updateOrganization(token, id, v);
      setEditingId(null);
      await refresh();
    } catch (e) {
      pushNotification({ tone: "danger", title: "Update failed", body: String(e) });
    } finally { setBusy(false); }
  }

  async function remove(o: TenantOrganization) {
    if (!confirm(`Remove "${o.name}"? Branches under it will also be removed.`)) return;
    const token = getToken();
    if (!token) return;
    setBusy(true);
    try {
      await api.deleteOrganization(token, o.id);
      await refresh();
    } catch (e) {
      pushNotification({ tone: "danger", title: "Delete failed", body: String(e) });
    } finally { setBusy(false); }
  }

  const filtered = organizations.filter((o) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      o.name.toLowerCase().includes(q) ||
      (o.trade_name ?? "").toLowerCase().includes(q) ||
      (o.vat_number ?? "").includes(q) ||
      (o.city ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <div>
      <PageHeader
        title="Organizations"
        description="Legal entities that issue invoices."
        actions={isAdmin && !adding && !editingId ? (
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
            + New organization
          </button>
        ) : null}
      />

      {adding && (
        <Card className="mb-4">
          <OrgForm
            value={{ name: "", country_code: "SA", is_default: organizations.length === 0 }}
            onSave={create}
            onCancel={() => setAdding(false)}
            busy={busy}
          />
        </Card>
      )}

      {/* Search */}
      <div className="mb-4 flex gap-2">
        <input
          className="input"
          style={{ maxWidth: 280 }}
          placeholder="Search organizations…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button className="btn btn-default" onClick={() => setSearch("")}>Reset</button>
        )}
      </div>

      <Card>
        {organizations.length === 0 ? (
          <p className="muted">No organizations yet. Add one to start issuing invoices.</p>
        ) : (
          <table className="responsive-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>VAT number</th>
                <th>City</th>
                <th>Status</th>
                {isAdmin && <th className="w-1 whitespace-nowrap text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((o) =>
                editingId === o.id ? (
                  <tr key={o.id}>
                    <td colSpan={isAdmin ? 5 : 4} className="py-3">
                      <OrgForm
                        value={o}
                        onSave={(v) => update(o.id, v)}
                        onCancel={() => setEditingId(null)}
                        busy={busy}
                      />
                    </td>
                  </tr>
                ) : (
                  <tr key={o.id} className="hover:bg-[var(--color-bg-hover)]">
                    <td data-label="Name" className="font-medium">
                      <div>{o.name}</div>
                      {o.trade_name && o.trade_name !== o.name && (
                        <div className="text-xs text-[var(--color-fg-muted)]">{o.trade_name}</div>
                      )}
                    </td>
                    <td data-label="VAT number" className="font-mono text-sm">
                      {o.vat_number ?? "—"}
                    </td>
                    <td data-label="City" className="text-[var(--color-fg-2)]">
                      {[o.city, o.country_code].filter(Boolean).join(", ") || "—"}
                    </td>
                    <td data-label="Status">
                      {o.is_default ? (
                        <span className="badge badge-neutral">default</span>
                      ) : (
                        <span className="text-[var(--color-fg-muted)] text-xs">—</span>
                      )}
                    </td>
                    {isAdmin && (
                      <td data-label="Actions" className="md:text-right whitespace-nowrap">
                        <div className="flex gap-2 md:justify-end">
                          <button
                            type="button"
                            className="btn btn-default !py-1 !px-2 text-xs"
                            onClick={() => setEditingId(o.id)}
                          >Edit</button>
                          {!o.is_default && (
                            <button
                              type="button"
                              className="btn btn-danger !py-1 !px-2 text-xs"
                              onClick={() => remove(o)}
                            >Remove</button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                )
              )}
              {filtered.length === 0 && (
                <tr><td colSpan={isAdmin ? 5 : 4} className="text-center muted py-4">No results.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function OrgForm({
  value, onSave, onCancel, busy,
}: {
  value: Partial<TenantOrganization>;
  onSave: (v: Partial<TenantOrganization>) => Promise<void>;
  onCancel: () => void;
  busy: boolean;
}) {
  const [draft, setDraft] = useState<Partial<TenantOrganization>>(value);
  function set<K extends keyof TenantOrganization>(k: K, v: TenantOrganization[K] | null) {
    setDraft((p) => ({ ...p, [k]: v }));
  }
  return (
    <div className="flex flex-col gap-3">
      <FieldGrid cols={2}>
        <Field label="Legal name" required>
          <input className="input" value={draft.name ?? ""} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label="Trade name">
          <input className="input" value={draft.trade_name ?? ""} onChange={(e) => set("trade_name", e.target.value || null)} />
        </Field>
        <Field label="VAT number">
          <input className="input font-mono" value={draft.vat_number ?? ""} onChange={(e) => set("vat_number", e.target.value || null)} />
        </Field>
        <Field label="Registration number">
          <input className="input font-mono" value={draft.registration_number ?? ""} onChange={(e) => set("registration_number", e.target.value || null)} />
        </Field>
        <Field label="Street">
          <input className="input" value={draft.street ?? ""} onChange={(e) => set("street", e.target.value || null)} />
        </Field>
        <Field label="Building number">
          <input className="input" value={draft.building_number ?? ""} onChange={(e) => set("building_number", e.target.value || null)} />
        </Field>
        <Field label="District">
          <input className="input" value={draft.city_subdivision ?? ""} onChange={(e) => set("city_subdivision", e.target.value || null)} />
        </Field>
        <Field label="City">
          <input className="input" value={draft.city ?? ""} onChange={(e) => set("city", e.target.value || null)} />
        </Field>
        <Field label="Postal zone">
          <input className="input font-mono" value={draft.postal_zone ?? ""} onChange={(e) => set("postal_zone", e.target.value || null)} />
        </Field>
        <Field label="Country">
          <input className="input uppercase font-mono" maxLength={2} value={draft.country_code ?? "SA"}
            onChange={(e) => set("country_code", e.target.value.toUpperCase())} />
        </Field>
      </FieldGrid>
      <label className="inline-flex items-center gap-2 text-sm">
        <input type="checkbox" checked={!!draft.is_default} onChange={(e) => set("is_default", e.target.checked)} />
        Make default organization
      </label>
      <div className="flex gap-2">
        <button type="button" className="btn btn-primary" disabled={busy || !draft.name}
          onClick={() => onSave({ ...draft, country_code: (draft.country_code || "SA").toUpperCase() })}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" className="btn btn-default" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}
