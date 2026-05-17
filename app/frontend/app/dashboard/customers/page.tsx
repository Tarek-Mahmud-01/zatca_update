"use client";

import { useEffect, useState } from "react";
import { api, type Customer } from "../../../lib/api-client";
import { getToken } from "../../../lib/token";
import { Banner, Card, Empty, Field, FieldGrid, PageHeader, Tabs } from "../../../components/ui";

type TabId = "list" | "add";

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

export default function CustomersPage() {
  const [tab, setTab] = useState<TabId>("list");
  const [rows, setRows] = useState<Customer[]>([]);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const token = getToken();
    if (!token) return;
    setLoading(true);
    try {
      setRows(await api.listCustomers(token, search || undefined));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [search]);

  async function onDelete(c: Customer) {
    if (!confirm(`Delete customer "${c.name}"?`)) return;
    const token = getToken();
    if (!token) return;
    try {
      await api.deleteCustomer(token, c.id);
      await reload();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div>
      <PageHeader
        title="Customers"
        description="Buyers you can quickly select when issuing invoices."
        actions={
          tab === "list" ? (
            <button className="btn btn-primary" onClick={() => { setEditing(null); setTab("add"); }}>
              + New customer
            </button>
          ) : null
        }
      />

      <Tabs<TabId>
        value={tab}
        onChange={(t) => { if (t === "list") setEditing(null); setTab(t); }}
        items={[
          { id: "list", label: "All customers", count: rows.length },
          { id: "add",  label: editing ? "Edit" : "New" },
        ]}
      />

      {error && <div className="mb-4"><Banner tone="danger">{error}</Banner></div>}

      {tab === "list" && (
        <>
          <div className="mb-4">
            <input
              className="input sm:max-w-xs"
              placeholder="Search by name or VAT…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {loading ? <p className="muted">Loading…</p> :
           rows.length === 0 ? (
            <Empty
              title={search ? "No matches" : "No customers yet"}
              description={search ? "Try a different search." : "Add a customer to pre-fill buyer details on invoices."}
              action={!search && (
                <button className="btn btn-primary" onClick={() => setTab("add")}>+ New customer</button>
              )}
            />
          ) : (
            <Card>
              <table className="responsive-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>VAT</th>
                    <th>City</th>
                    <th>Email</th>
                    <th className="w-1 whitespace-nowrap text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.id} className="hover:bg-[var(--color-bg-hover)]">
                      <td data-label="Name" className="font-medium">{c.name}</td>
                      <td data-label="VAT" className="text-[var(--color-fg-muted)] font-mono text-xs">{c.vat_number ?? "—"}</td>
                      <td data-label="City" className="text-[var(--color-fg-muted)]">{c.city || "—"}</td>
                      <td data-label="Email" className="text-[var(--color-fg-muted)]">{c.email ?? "—"}</td>
                      <td data-label="Actions" className="md:text-right">
                        <div className="flex gap-2 md:justify-end">
                          <button className="btn btn-default !py-1 !px-2 text-xs" onClick={() => { setEditing(c); setTab("add"); }}>Edit</button>
                          <button className="btn btn-danger  !py-1 !px-2 text-xs" onClick={() => onDelete(c)}>Delete</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </>
      )}

      {tab === "add" && (
        <CustomerForm
          editing={editing}
          onCancel={() => { setEditing(null); setTab("list"); }}
          onSaved={async () => { setEditing(null); await reload(); setTab("list"); }}
        />
      )}
    </div>
  );
}

function CustomerForm({
  editing, onCancel, onSaved,
}: {
  editing: Customer | null;
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [form, setForm] = useState<Partial<Customer>>(editing ?? EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function upd<K extends keyof Customer>(k: K, v: Customer[K] | null) {
    setForm((f) => ({ ...f, [k]: v as Customer[K] }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const token = getToken();
    if (!token) return;
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
      if (editing) await api.updateCustomer(token, editing.id, body);
      else         await api.createCustomer(token, body);
      await onSaved();
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
