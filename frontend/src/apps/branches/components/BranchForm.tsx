"use client";

import { useState } from "react";
import { Field, FieldGrid } from "@/app/core/components/ui";
import { SearchSelect } from "@/app/core/components/SearchSelect";
import type { TenantBranch } from "../types/branch.types";
import type { TenantOrganization } from "@/apps/organizations/types/organization.types";

export function BranchForm({
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
