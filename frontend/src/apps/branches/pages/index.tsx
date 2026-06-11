"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Provider } from "react-redux";
import { Card, PageHeader } from "@/app/core/components/ui";
import { getToken } from "@/apps/auth/utils/token";
import { pushNotification } from "@/apps/notifications/notifications";
import { useMe } from "@/apps/auth/store/session";
import { branchesStore, useBranchesDispatch } from "../store/branches.store";
import { createOne, updateOne, deleteOne } from "../store/branches.thunks";
import { useBranches } from "../hooks/useBranches";
import { BranchForm } from "../components/BranchForm";
import type { TenantBranch } from "../types/branch.types";
// Cross-feature READ: use the organizations SERVICE, not its store/hook.
import { organizationsApi } from "@/apps/organizations/services/organizations.api";
import type { TenantOrganization } from "@/apps/organizations/types/organization.types";

// Default export mounts this feature's own store Provider (no global Redux).
export default function BranchesSettingsPage() {
  return (
    <Provider store={branchesStore}>
      <BranchesView />
    </Provider>
  );
}

function BranchesView() {
  const dispatch = useBranchesDispatch();
  const { items: branches, refetch: refetchBranches } = useBranches();
  // Organizations are owned by another feature — fetch them via the service into
  // local state (never the organizations store/hook).
  const [organizations, setOrganizations] = useState<TenantOrganization[]>([]);
  const { me } = useMe();              // shared session — no per-page /me fetch
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterOrgId, setFilterOrgId] = useState("");

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    organizationsApi.listOrganizations(token)
      .then(setOrganizations)
      .catch((e) => pushNotification({ tone: "danger", title: "Load organizations failed", body: String(e) }));
  }, []);

  const isAdmin = me?.role === "admin";
  const orgsById = useMemo(
    () => new Map(organizations.map((o) => [o.id, o])),
    [organizations],
  );
  const noOrgs = organizations.length === 0;

  async function create(v: Partial<TenantBranch> & { organization_id: string }) {
    setBusy(true);
    try {
      await dispatch(createOne(v)).unwrap();
      setAdding(false);
      if (v.is_default) refetchBranches();  // default flips a sibling server-side
    } catch (e) {
      pushNotification({ tone: "danger", title: "Create branch failed", body: String(e) });
    } finally { setBusy(false); }
  }

  async function update(id: string, v: Partial<TenantBranch> & { organization_id: string }) {
    setBusy(true);
    try {
      await dispatch(updateOne({ id, body: v })).unwrap();
      setEditingId(null);
      if (v.is_default) refetchBranches();
    } catch (e) {
      pushNotification({ tone: "danger", title: "Update branch failed", body: String(e) });
    } finally { setBusy(false); }
  }

  async function remove(b: TenantBranch) {
    if (!confirm(`Remove branch "${b.name}"?`)) return;
    setBusy(true);
    try {
      await dispatch(deleteOne(b.id)).unwrap();
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
