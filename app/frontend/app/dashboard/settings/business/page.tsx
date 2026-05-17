"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, type Me } from "../../../../lib/api-client";
import { getToken } from "../../../../lib/token";
import { Banner, Card, Field, FieldGrid, PageHeader } from "../../../../components/ui";

export default function BusinessSettingsPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    api.me(token).then(setMe).catch((e) => setError(String(e)));
  }, []);

  return (
    <div>
      <PageHeader
        title="Business"
        description="Tenant identity used on every invoice. Set at sign-up; reach out to ops if you need to change it."
      />

      {error && <div className="mb-4"><Banner tone="danger">{error}</Banner></div>}

      {me ? (
        <div className="flex flex-col gap-4">
          <Card title="Legal entity">
            <FieldGrid cols={2}>
              <Field label="Company name">
                <input className="input" value={me.tenant_name} readOnly />
              </Field>
              <Field label="Tenant ID" hint="Used internally — appears in audit logs.">
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

          <Card title="ZATCA registration" description="Generated through the Onboarding wizard. One CSID set per API target.">
            <p className="text-sm text-[var(--color-fg-2)] leading-relaxed">
              CSIDs (compliance + production) are generated through the multi-step onboarding
              wizard. They're tied to your VAT number and live per environment (sandbox /
              simulation / production).
            </p>
            <div className="mt-3">
              <Link href="/dashboard/onboarding" className="btn btn-default">Go to onboarding →</Link>
            </div>
          </Card>
        </div>
      ) : (
        <p className="muted">Loading…</p>
      )}
    </div>
  );
}
