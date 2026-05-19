"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  api,
  type Me,
  type TenantBranch,
  type TenantOrganization,
} from "../../../../lib/api-client";
import { getToken } from "../../../../lib/token";
import { Card, Field, FieldGrid, PageHeader } from "../../../../components/ui";
import { SearchSelect } from "../../../../components/SearchSelect";
import { pushNotification } from "../../../../lib/notifications";

export default function BranchesSettingsPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [branches, setBranches] = useState<TenantBranch[]>([]);
  const [organizations, setOrganizations] = useState<TenantOrganization[]>([]);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterOrgId, setFilterOrgId] = useState("");

  const isAdmin = me?.role === "admin";
  const orgsById = useMemo(
    () => new Map(organizations.map((o) => [o.id, o])),
    [organizations],
  );
  const noOrgs = organizations.length === 0;

  async function refresh() {
    const token = getToken();
    if (!token) return;
    try {
      const [m, brs, orgs] = await Promise.all([
        api.me(token),
        api.listBranches(token),
        api.listOrganizations(token),
      ]);
      setMe(m);
      setBranches(brs);
      setOrganizations(orgs);
    } catch (e) {
      pushNotification({ tone: "danger", title: "Couldn't load branches", body: String(e) });
    }
  }
  useEffect(() => { refresh(); }, []);

  async function create(v: Partial<TenantBranch> & { organization_id: string }) {
    const token = getToken();
    if (!token) return;
    setBusy(true);
    try {
      await api.createBranch(token, v);
      setAdding(false);
      await refresh();
    } catch (e) {
      pushNotification({ tone: "danger", title: "Create branch failed", body: String(e) });
    } finally { setBusy(false); }
  }

  async function update(id: string, v: Partial<TenantBranch> & { organization_id: string }) {
    const token = getToken();
    if (!token) return;
    setBusy(true);
    try {
      await api.updateBranch(token, id, v);
      setEditingId(null);
      await refresh();
    } catch (e) {
      pushNotification({ tone: "danger", title: "Update branch failed", body: String(e) });
    } finally { setBusy(false); }
  }

  async function remove(b: TenantBranch) {
    if (!confirm(`Remove branch "${b.name}"?`)) return;
    const token = getToken();
    if (!token) return;
    setBusy(true);
    try {
      await api.deleteBranch(token, b.id);
      await refresh();
    } catch (e) {
      pushNotification({ tone: "danger", title: "Delete failed", body: String(e) });
    } finally { setBusy(false); }
  }

  const filtered = branches.filter((b) => {
    if (filterOrgId && b.organization_id !== filterOrgId) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      b.name.toLowerCase().includes(q) ||
      (b.code ?? "").toLowerCase().includes(q) ||
      (b.city ?? "").toLowerCase().includes(q) ||
      (orgsById.get(b.organization_id)?.name ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <div>
      <PageHeader
        title="Branches"
        description="Physical locations anchored to an organization. Appear as supplier party metadata on invoices."
        actions={isAdmin && !adding && !editingId ? (
          <button
            type="button"
            className="btn btn-primary"
            disabled={noOrgs}
            title={noOrgs ? "Add at least one organization first" : undefined}
            onClick={() => setAdding(true)}
          >
            + New branch
          </button>
        ) : null}
      />

      {noOrgs && (
        <div className="mb-4 p-3 rounded-md border border-[var(--color-border)] text-sm text-[var(--color-fg-2)]">
          Add at least one{" "}
          <Link className="underline" href="/dashboard/settings/organizations">organization</Link>{" "}
          before creating branches.
        </div>
      )}

      {adding && (
        <Card className="mb-4">
          <BranchForm
            value={{
              name: "",
              country_code: "SA",
              is_default: branches.length === 0,
              organization_id: organizations.find((o) => o.is_default)?.id ?? organizations[0]?.id ?? "",
            }}
            organizations={organizations}
            onSave={create}
            onCancel={() => setAdding(false)}
            busy={busy}
          />
        </Card>
      )}

      {/* Filters */}
      <div className="mb-4 flex flex-wrap gap-2">
        <input
          className="input"
          style={{ maxWidth: 240 }}
          placeholder="Search branches…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {organizations.length > 1 && (
          <select
            className="input"
            style={{ maxWidth: 200 }}
            value={filterOrgId}
            onChange={(e) => setFilterOrgId(e.target.value)}
          >
            <option value="">All organizations</option>
            {organizations.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        )}
        {(search || filterOrgId) && (
          <button className="btn btn-default" onClick={() => { setSearch(""); setFilterOrgId(""); }}>Reset</button>
        )}
      </div>

      <Card>
        {branches.length === 0 && !noOrgs ? (
          <p className="muted">No branches yet.</p>
        ) : !noOrgs ? (
          <table className="responsive-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Organization</th>
                <th>City</th>
                <th>Status</th>
                {isAdmin && <th className="w-1 whitespace-nowrap text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((b) =>
                editingId === b.id ? (
                  <tr key={b.id}>
                    <td colSpan={isAdmin ? 6 : 5} className="py-3">
                      <BranchForm
                        value={b}
                        organizations={organizations}
                        onSave={(v) => update(b.id, v)}
                        onCancel={() => setEditingId(null)}
                        busy={busy}
                      />
                    </td>
                  </tr>
                ) : (
                  <tr key={b.id} className="hover:bg-[var(--color-bg-hover)]">
                    <td data-label="Code" className="font-mono text-sm text-[var(--color-fg-muted)]">
                      {b.code || "—"}
                    </td>
                    <td data-label="Name" className="font-medium">{b.name}</td>
                    <td data-label="Organization" className="text-[var(--color-fg-2)]">
                      {orgsById.get(b.organization_id)?.name ?? "—"}
                    </td>
                    <td data-label="City" className="text-[var(--color-fg-2)]">
                      {[b.city, b.country_code].filter(Boolean).join(", ") || "—"}
                    </td>
                    <td data-label="Status">
                      {b.is_default ? (
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
                            onClick={() => setEditingId(b.id)}
                          >Edit</button>
                          <button
                            type="button"
                            className="btn btn-danger !py-1 !px-2 text-xs"
                            onClick={() => remove(b)}
                          >Remove</button>
                        </div>
                      </td>
                    )}
                  </tr>
                )
              )}
              {filtered.length === 0 && branches.length > 0 && (
                <tr><td colSpan={isAdmin ? 6 : 5} className="text-center muted py-4">No results.</td></tr>
              )}
            </tbody>
          </table>
        ) : null}
      </Card>
    </div>
  );
}

function BranchForm({
  value, organizations, onSave, onCancel, busy,
}: {
  value: Partial<TenantBranch> & { organization_id?: string };
  organizations: TenantOrganization[];
  onSave: (v: Partial<TenantBranch> & { organization_id: string }) => Promise<void>;
  onCancel: () => void;
  busy: boolean;
}) {
  const [draft, setDraft] = useState<Partial<TenantBranch> & { organization_id?: string }>(value);
  function set<K extends keyof TenantBranch>(k: K, v: TenantBranch[K] | null) {
    setDraft((p) => ({ ...p, [k]: v }));
  }
  return (
    <div className="flex flex-col gap-3">
      <FieldGrid cols={2}>
        <Field label="Organization" required>
          <SearchSelect
            value={draft.organization_id ?? ""}
            onChange={(v) => setDraft((p) => ({ ...p, organization_id: v }))}
            placeholder="— select organization —"
            options={organizations.map((o) => ({ value: o.id, label: o.name + (o.is_default ? " (default)" : "") }))}
            searchPlaceholder="Search organizations…"
          />
        </Field>
        <Field label="Branch name" required>
          <input className="input" value={draft.name ?? ""} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label="Branch code">
          <input className="input font-mono" value={draft.code ?? ""} onChange={(e) => set("code", e.target.value || null)} />
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
        Make default branch
      </label>
      <div className="flex gap-2">
        <button type="button" className="btn btn-primary"
          disabled={busy || !draft.name || !draft.organization_id}
          onClick={() => onSave({ ...draft, organization_id: draft.organization_id!, country_code: (draft.country_code || "SA").toUpperCase() })}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" className="btn btn-default" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}
