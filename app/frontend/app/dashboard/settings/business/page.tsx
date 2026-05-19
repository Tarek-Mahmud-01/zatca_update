"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, type Me } from "../../../../lib/api-client";
import { getToken } from "../../../../lib/token";
import { Card, Field, FieldGrid, PageHeader } from "../../../../components/ui";
import { pushNotification } from "../../../../lib/notifications";

export default function BusinessSettingsPage() {
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    api.me(token).then(setMe).catch((e) => pushNotification({
      tone: "danger", title: "Couldn't load account", body: String(e),
    }));
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Business"
        description="Tenant identity used by every invoice. Currencies, organizations, and branches are managed on their own pages."
      />

      {me ? (
        <Card title="Tenant identity" description="Set at signup. Contact ops to change a legal identifier.">
          <FieldGrid cols={2}>
            <Field label="Tenant name">
              <input className="input" value={me.tenant_name} readOnly />
            </Field>
            <Field label="Tenant ID" hint="Appears in audit logs.">
              <input className="input font-mono" value={me.tenant_id} readOnly />
            </Field>
            <Field label="VAT number">
              <input className="input font-mono" value={me.vat_number} readOnly />
            </Field>
            <Field label="Organization identifier">
              <input className="input font-mono" value={me.organization_identifier} readOnly />
            </Field>
          </FieldGrid>
        </Card>
      ) : (
        <Card><p className="muted">Loading…</p></Card>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Link href="/dashboard/settings/currencies"
          className="p-4 rounded-md border border-[var(--color-border)] bg-white hover:bg-[var(--color-bg-hover)] no-underline">
          <div className="font-medium text-[var(--color-fg)]">Currencies →</div>
          <div className="text-xs text-[var(--color-fg-muted)] mt-1">
            Manage the list of accepted currencies and their daily exchange rates.
          </div>
        </Link>
        <Link href="/dashboard/settings/organizations"
          className="p-4 rounded-md border border-[var(--color-border)] bg-white hover:bg-[var(--color-bg-hover)] no-underline">
          <div className="font-medium text-[var(--color-fg)]">Organizations →</div>
          <div className="text-xs text-[var(--color-fg-muted)] mt-1">
            Legal entities that issue invoices. Each invoice picks one as the supplier.
          </div>
        </Link>
        <Link href="/dashboard/settings/branches"
          className="p-4 rounded-md border border-[var(--color-border)] bg-white hover:bg-[var(--color-bg-hover)] no-underline">
          <div className="font-medium text-[var(--color-fg)]">Branches →</div>
          <div className="text-xs text-[var(--color-fg-muted)] mt-1">
            Multi-location retailers: each branch is anchored to an organization.
          </div>
        </Link>
      </div>

      <Card title="ZATCA registration" description="Generated through the onboarding wizard. One CSID set per API target.">
        <p className="text-sm text-[var(--color-fg-2)] leading-relaxed">
          CSIDs (compliance + production) are tied to your VAT number and live per environment (sandbox / simulation / production).
        </p>
        <div className="mt-3">
          <Link href="/dashboard/onboarding" className="btn btn-default">Go to onboarding →</Link>
        </div>
      </Card>
    </div>
  );
}
