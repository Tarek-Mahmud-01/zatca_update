"use client";

import Link from "next/link";
import { handleAuthExpired } from "../../../../lib/token";
import { Banner, Card, Field, FieldGrid, PageHeader } from "../../../../components/ui";
import { useMe } from "../../../../lib/store";

export default function AccountSettingsPage() {
  const { me, error } = useMe();       // shared session — no per-page /me fetch

  function signOut() {
    // Goes through the shared handler so the cookie is wiped AND every
    // other open tab gets the logout broadcast via BroadcastChannel.
    handleAuthExpired();
  }

  return (
    <div>
      <PageHeader
        title="Account"
        description="The user you're signed in as."
        actions={
          <button className="btn btn-default" onClick={signOut}>Sign out</button>
        }
      />

      {error && <div className="mb-4"><Banner tone="danger">{error}</Banner></div>}

      {me ? (
        <div className="flex flex-col gap-4">
          <Card title="Profile">
            <FieldGrid cols={2}>
              <Field label="Email">
                <input className="input" value={me.email} readOnly />
              </Field>
              <Field label="Role">
                <input className="input" value={me.role} readOnly />
              </Field>
              <Field label="User ID">
                <input className="input font-mono" value={me.user_id} readOnly />
              </Field>
              <Field label="Tenant">
                <Link href="/dashboard/settings/business" className="input flex items-center text-[var(--color-accent)] hover:underline">
                  {me.tenant_name}
                </Link>
              </Field>
            </FieldGrid>
          </Card>

          <Card title="Sessions" description="Sign-in tokens are stored as cookies. Signing out clears this device.">
            <button className="btn btn-default" onClick={signOut}>Sign out of this device</button>
          </Card>
        </div>
      ) : (
        <p className="muted">Loading…</p>
      )}
    </div>
  );
}
