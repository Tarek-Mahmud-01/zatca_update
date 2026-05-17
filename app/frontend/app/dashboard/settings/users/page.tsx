"use client";

import { useEffect, useState } from "react";
import { api, type Me, type TenantUser } from "../../../../lib/api-client";
import { getToken } from "../../../../lib/token";
import { Banner, Card, Empty, Field, FieldGrid, PageHeader, Tabs } from "../../../../components/ui";

type TabId = "list" | "invite";
const ROLES = ["admin", "member", "viewer"] as const;

export default function UsersPage() {
  const [tab, setTab] = useState<TabId>("list");
  const [me, setMe] = useState<Me | null>(null);
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function reload() {
    const token = getToken();
    if (!token) return;
    setLoading(true);
    try {
      const [meRes, list] = await Promise.all([api.me(token), api.listTenantUsers(token)]);
      setMe(meRes);
      setUsers(list);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { reload(); }, []);

  async function changeRole(u: TenantUser, role: string) {
    const token = getToken();
    if (!token) return;
    try {
      await api.updateTenantUserRole(token, u.id, role);
      await reload();
    } catch (e) {
      setError(String(e));
    }
  }

  async function remove(u: TenantUser) {
    if (!confirm(`Remove ${u.email}? They lose access immediately.`)) return;
    const token = getToken();
    if (!token) return;
    try {
      await api.removeTenantUser(token, u.id);
      await reload();
    } catch (e) {
      setError(String(e));
    }
  }

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
        <InviteForm onCancel={() => setTab("list")} onSaved={async () => { await reload(); setTab("list"); }} />
      )}
    </div>
  );
}

function InviteForm({ onCancel, onSaved }: { onCancel: () => void; onSaved: () => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<typeof ROLES[number]>("member");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const token = getToken();
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await api.inviteTenantUser(token, { email, password, role });
      await onSaved();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Add a team member" description="Set a starting password — they can change it after signing in.">
      <form onSubmit={submit} className="flex flex-col gap-5">
        <FieldGrid cols={2}>
          <Field label="Email" required>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="off" />
          </Field>
          <Field label="Role" required hint="admin = full control · member = day-to-day · viewer = read-only">
            <select className="input" value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </Field>
          <Field label="Temporary password" required hint="Min 8 characters">
            <input className="input" type="text" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete="new-password" />
          </Field>
        </FieldGrid>

        {error && <Banner tone="danger">{error}</Banner>}

        <div className="flex gap-2">
          <button className="btn btn-primary" disabled={busy} type="submit">{busy ? "Adding…" : "Add user"}</button>
          <button className="btn btn-default" type="button" onClick={onCancel}>Cancel</button>
        </div>
      </form>
    </Card>
  );
}
