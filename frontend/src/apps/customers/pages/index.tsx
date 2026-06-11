"use client";

import { useState } from "react";
import { Provider } from "react-redux";
import { Banner, Card, Empty, PageHeader, Tabs } from "@/app/core/components/ui";
import { customersStore, useCustomersDispatch } from "../store/customers.store";
import { deleteOne } from "../store/customers.thunks";
import { useCustomers } from "../hooks/useCustomers";
import { CustomerForm } from "../components/CustomerForm";
import type { Customer } from "../types/customer.types";

type TabId = "list" | "add";

// Default export mounts this feature's own store Provider (no global Redux).
export default function CustomersPage() {
  return (
    <Provider store={customersStore}>
      <CustomersView />
    </Provider>
  );
}

function CustomersView() {
  const dispatch = useCustomersDispatch();
  const { items: allRows, loading, error: loadError } = useCustomers();
  const [tab, setTab] = useState<TabId>("list");
  const [editing, setEditing] = useState<Customer | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  const q = search.trim().toLowerCase();
  const rows = q
    ? allRows.filter((c) =>
        c.name.toLowerCase().includes(q) ||
        (c.vat_number ?? "").toLowerCase().includes(q))
    : allRows;

  async function onDelete(c: Customer) {
    if (!confirm(`Delete customer "${c.name}"?`)) return;
    setError(null);
    try {
      await dispatch(deleteOne(c.id)).unwrap();
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

      {(error || loadError) && <div className="mb-4"><Banner tone="danger">{error || loadError}</Banner></div>}

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
          onSaved={() => { setEditing(null); setTab("list"); }}
        />
      )}
    </div>
  );
}
