"use client";

import { useEffect, useMemo, useState } from "react";
import { Provider } from "react-redux";
import { Banner, Card, Empty, PageHeader, Tabs } from "@/app/core/components/ui";
import { getToken } from "@/apps/auth/utils/token";
import { pushNotification } from "@/apps/notifications/notifications";
import { useMe } from "@/apps/auth/store/session";
import { usersStore, useUsersDispatch } from "../store/users.store";
import { deleteOne } from "../store/users.thunks";
import { usersActions } from "../store/users.slice";
import { useUsers } from "../hooks/useUsers";
import { InviteForm } from "../components/InviteForm";
import { tenantUsersApi } from "../services/users.api";
import type { TenantUser } from "../types/user.types";
// Cross-feature READ: use the branches SERVICE, not its store/hook.
import { branchesApi } from "@/apps/branches/services/branches.api";
import type { TenantBranch } from "@/apps/branches/types/branch.types";

type TabId = "list" | "invite";
const ROLES = ["admin", "member", "viewer"] as const;

// Default export mounts this feature's own store Provider (no global Redux).
export default function UsersPage() {
  return (
    <Provider store={usersStore}>
      <UsersView />
    </Provider>
  );
}

function UsersView() {
  const dispatch = useUsersDispatch();
  const { items: users, loading } = useUsers();
  // Branches are owned by another feature — fetch via the service into local
  // state (never the branches store/hook).
  const [branches, setBranches] = useState<TenantBranch[]>([]);
  const [tab, setTab] = useState<TabId>("list");
  const { me } = useMe();              // shared session — no per-page /me fetch
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    branchesApi.listBranches(token)
      .then(setBranches)
      .catch((e) => pushNotification({ tone: "danger", title: "Load branches failed", body: String(e) }));
  }, []);

  async function changeRole(u: TenantUser, role: string) {
    const token = getToken();
    if (!token) return;
    try {
      // Role/branch endpoints return the fresh row — upsert it into the store.
      const updated = await tenantUsersApi.updateTenantUserRole(token, u.id, role);
      dispatch(usersActions.upsertOne(updated));
    } catch (e) {
      setError(String(e));
    }
  }

  async function changeBranch(u: TenantUser, branchId: string | null) {
    const token = getToken();
    if (!token) return;
    try {
      const updated = await tenantUsersApi.updateTenantUserBranch(token, u.id, branchId);
      dispatch(usersActions.upsertOne(updated));
    } catch (e) {
      setError(String(e));
    }
  }

  async function remove(u: TenantUser) {
    if (!confirm(`Remove ${u.email}? They lose access immediately.`)) return;
    try {
      await dispatch(deleteOne(u.id)).unwrap();
    } catch (e) {
      setError(String(e));
    }
  }

  const branchesById = useMemo(
    () => new Map(branches.map((b) => [b.id, b])),
    [branches],
  );

  const isAdmin = me?.role === "admin";

  return (
    <div>
      <PageHeader
        title="Team members"
        description="People who can sign in to this tenant. Admins can invite and manage roles."
        actions={
          tab === "list" && isAdmin ? (
            <button className="btn btn-primary" onClick={() => setTab("invite")}>+ Add user</button>
          ) : null
        }
      />

      <Tabs<TabId>
        value={tab}
        onChange={setTab}
        items={[
          { id: "list",   label: "All members", count: users.length },
          { id: "invite", label: "Invite", disabled: !isAdmin },
        ]}
      />

      {error && <div className="mb-4"><Banner tone="danger">{error}</Banner></div>}
      {!isAdmin && (
        <div className="mb-4">
          <Banner tone="neutral">
            You&apos;re signed in as <strong>{me?.role}</strong>. Only admins can invite or change roles.
          </Banner>
        </div>
      )}

      {tab === "list" && (
        loading ? <p className="muted">Loading…</p> :
        users.length === 0 ? (
          <Empty title="No members yet" description="Invite your first teammate." />
        ) : (
          <Card>
            <table className="responsive-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Default branch</th>
                  <th>Joined</th>
                  <th className="w-1 whitespace-nowrap text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-[var(--color-bg-hover)]">
                    <td data-label="Email" className="font-medium">
                      {u.email}{u.is_me && <span className="ml-2 badge badge-neutral">you</span>}
                    </td>
                    <td data-label="Role">
                      {isAdmin && !u.is_me ? (
                        <select
                          className="input !py-1 !w-auto text-xs"
                          value={u.role}
                          onChange={(e) => changeRole(u, e.target.value)}
                        >
                          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                        </select>
                      ) : (
                        <span className="capitalize text-[var(--color-fg-2)]">{u.role}</span>
                      )}
                    </td>
                    <td data-label="Default branch">
                      {isAdmin ? (
                        <select
                          className="input !py-1 !w-auto text-xs"
                          value={u.default_branch_id ?? ""}
                          disabled={branches.length === 0}
                          onChange={(e) => changeBranch(u, e.target.value || null)}
                        >
                          <option value="">— none —</option>
                          {branches.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.name}{b.code ? ` · ${b.code}` : ""}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-[var(--color-fg-2)]">
                          {u.default_branch_id ? (branchesById.get(u.default_branch_id)?.name ?? "—") : "—"}
                        </span>
                      )}
                    </td>
                    <td data-label="Joined" className="text-[var(--color-fg-muted)]">
                      {new Date(u.created_at).toLocaleDateString()}
                    </td>
                    <td data-label="Actions" className="md:text-right">
                      {isAdmin && !u.is_me && (
                        <button className="btn btn-danger !py-1 !px-2 text-xs" onClick={() => remove(u)}>Remove</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )
      )}

      {tab === "invite" && isAdmin && (
        <InviteForm branches={branches} onCancel={() => setTab("list")} onSaved={() => setTab("list")} />
      )}
    </div>
  );
}
