"use client";

import { useState } from "react";
import { Provider } from "react-redux";
import { Banner, Card, Empty, PageHeader, Tabs } from "@/app/core/components/ui";
import { categoriesStore, useCategoriesDispatch } from "../store/categories.store";
import { deleteOne } from "../store/categories.thunks";
import { useCategories } from "../hooks/useCategories";
import { CategoryForm } from "../components/CategoryForm";
import type { Category } from "../types/category.types";

type TabId = "list" | "add";

export default function CategoriesPage() {
  return (
    <Provider store={categoriesStore}>
      <CategoriesView />
    </Provider>
  );
}

function CategoriesView() {
  const dispatch = useCategoriesDispatch();
  const { items: rows, loading, error: loadError } = useCategories();
  const [tab, setTab] = useState<TabId>("list");
  const [editing, setEditing] = useState<Category | null>(null);
  const [error, setError] = useState<string | null>(null);

  function onEdit(cat: Category) {
    setEditing(cat);
    setTab("add");
  }

  async function onDelete(cat: Category) {
    if (!confirm(`Delete category "${cat.name}"?`)) return;
    setError(null);
    try {
      await dispatch(deleteOne(cat.id)).unwrap();
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

      {(error || loadError) && <div className="mb-4"><Banner tone="danger">{error || loadError}</Banner></div>}

      {tab === "list" && (
        loading ? <p className="muted">Loading…</p> :
        rows.length === 0 ? (
          <Empty
            title="No categories yet"
            description="Categories help organize your product catalog. Create your first one."
            action={<button className="btn btn-primary" onClick={() => setTab("add")}>+ New category</button>}
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
          onSaved={() => { setEditing(null); setTab("list"); }}
        />
      )}
    </div>
  );
}
