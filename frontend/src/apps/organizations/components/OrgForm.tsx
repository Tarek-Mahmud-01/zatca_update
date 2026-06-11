"use client";

import { useState } from "react";
import { Field, FieldGrid } from "@/app/core/components/ui";
import type { TenantOrganization } from "../types/organization.types";

export function OrgForm({
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
