"use client";

import { useState } from "react";
import { Banner, Card, Field, FieldGrid } from "@/app/core/components/ui";
import { useCustomersDispatch } from "../store/customers.store";
import { createOne, updateOne } from "../store/customers.thunks";
import type { Customer } from "../types/customer.types";

const EMPTY: Partial<Customer> = {
  external_id: "",
  name: "",
  vat_number: "",
  crn: "",
  email: "",
  phone: "",
  street: "",
  building_number: "",
  city_subdivision: "",
  city: "Riyadh",
  postal_zone: "",
  country_code: "SA",
};

export function CustomerForm({
  editing, onCancel, onSaved,
}: {
  editing: Customer | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const dispatch = useCustomersDispatch();
  const [form, setForm] = useState<Partial<Customer>>(editing ?? EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function upd<K extends keyof Customer>(k: K, v: Customer[K] | null) {
    setForm((f) => ({ ...f, [k]: v as Customer[K] }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body: Partial<Customer> = {
        ...form,
        external_id: form.external_id || null,
        vat_number:  form.vat_number  || null,
        crn:         form.crn         || null,
        email:       form.email       || null,
        phone:       form.phone       || null,
      };
      if (editing) await dispatch(updateOne({ id: editing.id, body })).unwrap();
      else         await dispatch(createOne(body)).unwrap();
      onSaved();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={editing ? "Edit customer" : "New customer"}>
      <form onSubmit={submit} className="flex flex-col gap-5">
        <FieldGrid cols={2}>
          <Field label="Name" required>
            <input className="input" value={form.name ?? ""} onChange={(e) => upd("name", e.target.value)} required maxLength={200} />
          </Field>
          <Field label="External ID" hint="Your internal customer number (optional)">
            <input className="input" value={form.external_id ?? ""} onChange={(e) => upd("external_id", e.target.value)} />
          </Field>
        </FieldGrid>

        <FieldGrid cols={3}>
          <Field label="VAT number" hint="15 digits, required for B2B invoices">
            <input className="input font-mono" value={form.vat_number ?? ""} onChange={(e) => upd("vat_number", e.target.value)} maxLength={15} />
          </Field>
          <Field label="Commercial registration (CRN)">
            <input className="input" value={form.crn ?? ""} onChange={(e) => upd("crn", e.target.value)} />
          </Field>
          <Field label="Country code">
            <input className="input" value={form.country_code ?? "SA"} onChange={(e) => upd("country_code", e.target.value.toUpperCase())} maxLength={2} />
          </Field>
        </FieldGrid>

        <FieldGrid cols={2}>
          <Field label="Email">
            <input className="input" type="email" value={form.email ?? ""} onChange={(e) => upd("email", e.target.value)} />
          </Field>
          <Field label="Phone">
            <input className="input" value={form.phone ?? ""} onChange={(e) => upd("phone", e.target.value)} />
          </Field>
        </FieldGrid>

        <div className="text-xs font-medium text-[var(--color-fg-muted)] uppercase tracking-wide pt-2">Address</div>
        <FieldGrid cols={2}>
          <Field label="Street">
            <input className="input" value={form.street ?? ""} onChange={(e) => upd("street", e.target.value)} />
          </Field>
          <Field label="Building number">
            <input className="input" value={form.building_number ?? ""} onChange={(e) => upd("building_number", e.target.value)} />
          </Field>
        </FieldGrid>
        <FieldGrid cols={3}>
          <Field label="District">
            <input className="input" value={form.city_subdivision ?? ""} onChange={(e) => upd("city_subdivision", e.target.value)} />
          </Field>
          <Field label="City">
            <input className="input" value={form.city ?? ""} onChange={(e) => upd("city", e.target.value)} />
          </Field>
          <Field label="Postal zone">
            <input className="input" value={form.postal_zone ?? ""} onChange={(e) => upd("postal_zone", e.target.value)} />
          </Field>
        </FieldGrid>

        {error && <Banner tone="danger">{error}</Banner>}

        <div className="flex gap-2">
          <button className="btn btn-primary" disabled={busy} type="submit">
            {busy ? "Saving…" : editing ? "Save changes" : "Create customer"}
          </button>
          <button className="btn btn-default" type="button" onClick={onCancel}>Cancel</button>
        </div>
      </form>
    </Card>
  );
}
