"use client";

import { useEffect, useState } from "react";
import { api, type Category } from "../../../lib/api-client";
import { getToken } from "../../../lib/token";
import { Banner, Card, Empty, Field, FieldGrid, PageHeader, Tabs } from "../../../components/ui";

type TabId = "list" | "add";

export default function CategoriesPage() {
  const [tab, setTab] = useState<TabId>("list");
  const [rows, setRows] = useState<Category[]>([]);
  const [editing, setEditing] = useState<Category | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function reload() {
    const token = getToken();
    if (!token) return;
    setLoading(true);
    try {
      setRows(await api.listCategories(token));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { reload(); }, []);

  function onEdit(cat: Category) {
    setEditing(cat);
    setTab("add");
  }

  async function onDelete(cat: Category) {
    if (!confirm(`Delete category "${cat.name}"?`)) return;
    const token = getToken();
    if (!token) return;
    try {
      await api.deleteCategory(token, cat.id);
      await reload();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div>
      <PageHeader
        title="Categories"
        description="Group products into categories for easier invoice line-item selection."
        actions={
          tab === "list" ? (
            <button className="btn btn-primary" onClick={() => { setEditing(null); setTab("add"); }}>
              + New category
            </button>
          ) : null
        }
      />

      <Tabs<TabId>
        value={tab}
        onChange={(t) => { if (t === "list") setEditing(null); setTab(t); }}
        items={[
          { id: "list", label: "All categories", count: rows.length },
          { id: "add",  label: editing ? "Edit" : "New" },
        ]}
      />

      {error && <div className="mb-4"><Banner tone="danger">{error}</Banner></div>}

      {tab === "list" && (
        loading ? <p className="muted">Loading…</p> :
        rows.length === 0 ? (
          <Empty
            title="No categories yet"
            description="Categories help organize your product catalog. Create your first one."
            action={
              <button className="btn btn-primary" onClick={() => setTab("add")}>+ New category</button>
            }
          />
        ) : (
          <Card>
            <table className="responsive-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Description</th>
                  <th className="w-1 whitespace-nowrap text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className="hover:bg-[var(--color-bg-hover)]">
                    <td data-label="Name" className="font-medium">{c.name}</td>
                    <td data-label="Description" className="text-[var(--color-fg-muted)]">{c.description ?? "—"}</td>
                    <td data-label="Actions" className="md:text-right">
                      <div className="flex gap-2 md:justify-end">
                        <button className="btn btn-default !py-1 !px-2 text-xs" onClick={() => onEdit(c)}>Edit</button>
                        <button className="btn btn-danger !py-1 !px-2 text-xs" onClick={() => onDelete(c)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )
      )}

      {tab === "add" && (
        <CategoryForm
          editing={editing}
          onCancel={() => { setEditing(null); setTab("list"); }}
          onSaved={async () => { setEditing(null); await reload(); setTab("list"); }}
        />
      )}
    </div>
  );
}

function CategoryForm({
  editing, onCancel, onSaved,
}: { editing: Category | null; onCancel: () => void; onSaved: () => void | Promise<void> }) {
  const [name, setName] = useState(editing?.name ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const token = getToken();
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      if (editing) await api.updateCategory(token, editing.id, { name, description });
      else         await api.createCategory(token, { name, description });
      await onSaved();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={editing ? "Edit category" : "New category"}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <FieldGrid cols={2}>
          <Field label="Name" required>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
          </Field>
          <Field label="Description" hint="Optional — shown in invoice line-item picker.">
            <input className="input" value={description ?? ""} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </FieldGrid>
        {error && <Banner tone="danger">{error}</Banner>}
        <div className="flex gap-2">
          <button className="btn btn-primary" disabled={busy} type="submit">
            {busy ? "Saving…" : editing ? "Save changes" : "Create category"}
          </button>
          <button className="btn btn-default" type="button" onClick={onCancel}>Cancel</button>
        </div>
      </form>
    </Card>
  );
}
