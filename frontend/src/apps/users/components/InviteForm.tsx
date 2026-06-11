"use client";

import { useState } from "react";
import { Banner, Card, Field, FieldGrid } from "@/app/core/components/ui";
import { useUsersDispatch } from "../store/users.store";
import { createOne } from "../store/users.thunks";
import type { TenantBranch } from "@/apps/branches/types/branch.types";

const ROLES = ["admin", "member", "viewer"] as const;

export function InviteForm({
  branches, onCancel, onSaved,
}: {
  branches: TenantBranch[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const dispatch = useUsersDispatch();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<typeof ROLES[number]>("member");
  const [defaultBranchId, setDefaultBranchId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // Thunk upserts the new user into the store on success.
      await dispatch(createOne({
        email, password, role,
        default_branch_id: defaultBranchId || null,
      })).unwrap();
      onSaved();
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
          <Field label="Default branch" hint="Pre-selects this branch on new invoices for the user.">
            <select className="input" value={defaultBranchId} disabled={branches.length === 0}
              onChange={(e) => setDefaultBranchId(e.target.value)}>
              <option value="">— none —</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}{b.code ? ` · ${b.code}` : ""}</option>
              ))}
            </select>
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
