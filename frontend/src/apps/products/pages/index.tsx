"use client";

import { useEffect, useState } from "react";
import { Provider } from "react-redux";
import { Banner, Card, Empty, PageHeader, Select, Tabs } from "@/app/core/components/ui";
import { getToken } from "@/apps/auth/utils/token";
import { productsStore, useProductsDispatch } from "../store/products.store";
import { deleteOne } from "../store/products.thunks";
import { useProducts } from "../hooks/useProducts";
import { ProductForm } from "../components/ProductForm";
import type { Product } from "../types/product.types";
// Cross-feature READ via the categories SERVICE (not its store) — keeps the
// products feature independent of the categories store/Provider.
import { categoriesApi } from "@/apps/categories/services/categories.api";
import type { Category } from "@/apps/categories/types/category.types";

type TabId = "list" | "add";

export default function ProductsPage() {
  return (
    <Provider store={productsStore}>
      <ProductsView />
    </Provider>
  );
}

function ProductsView() {
  const dispatch = useProductsDispatch();
  const { items: allRows, loading, error: loadError } = useProducts();
  const [cats, setCats] = useState<Category[]>([]);
  const [tab, setTab] = useState<TabId>("list");
  const [editing, setEditing] = useState<Product | null>(null);
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = getToken();
    if (t) categoriesApi.listCategories(t).then(setCats).catch(() => setCats([]));
  }, []);

  const q = search.trim().toLowerCase();
  const rows = allRows.filter((p) =>
    (!q || p.sku.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)) &&
    (!filterCat || p.category_id === filterCat));

  function onEdit(p: Product) { setEditing(p); setTab("add"); }

  async function onDelete(p: Product) {
    if (!confirm(`Delete product "${p.name}"?`)) return;
    setError(null);
    try {
      await dispatch(deleteOne(p.id)).unwrap();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div>
      <PageHeader
        title="Products"
        description="Items you sell. Pulled into invoices as line items."
        actions={
          tab === "list" ? (
            <button className="btn btn-primary" onClick={() => { setEditing(null); setTab("add"); }}>
              + New product
            </button>
          ) : null
        }
      />

      <Tabs<TabId>
        value={tab}
        onChange={(t) => { if (t === "list") setEditing(null); setTab(t); }}
        items={[
          { id: "list", label: "All products", count: rows.length },
          { id: "add",  label: editing ? "Edit" : "New" },
        ]}
      />

      {(error || loadError) && <div className="mb-4"><Banner tone="danger">{error || loadError}</Banner></div>}

      {tab === "list" && (
        <>
          <div className="flex flex-col sm:flex-row gap-2 mb-4">
            <input
              className="input sm:max-w-xs"
              placeholder="Search SKU or name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Select className="sm:max-w-xs" value={filterCat} onChange={(e) => setFilterCat(e.target.value)}>
              <option value="">All categories</option>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </div>

          {loading ? <p className="muted">Loading…</p> :
           rows.length === 0 ? (
            <Empty
              title={search || filterCat ? "No matches" : "No products yet"}
              description={search || filterCat ? "Try clearing filters." : "Add a product to start building invoices from your catalog."}
              action={!(search || filterCat) && (
                <button className="btn btn-primary" onClick={() => setTab("add")}>+ New product</button>
              )}
            />
          ) : (
            <Card>
              <table className="responsive-table">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Name</th>
                    <th>Category</th>
                    <th className="text-right">Unit price</th>
                    <th>VAT</th>
                    <th className="w-1 whitespace-nowrap text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id} className="hover:bg-[var(--color-bg-hover)]">
                      <td data-label="SKU" className="font-mono text-xs">{p.sku}</td>
                      <td data-label="Name" className="font-medium">{p.name}</td>
                      <td data-label="Category" className="text-[var(--color-fg-muted)]">{p.category_name ?? "—"}</td>
                      <td data-label="Unit price" className="md:text-right tabular-nums">{p.unit_price}</td>
                      <td data-label="VAT">
                        <span className="badge badge-neutral">{p.tax_category} · {p.tax_percent}%</span>
                      </td>
                      <td data-label="Actions" className="md:text-right">
                        <div className="flex gap-2 md:justify-end">
                          <button className="btn btn-default !py-1 !px-2 text-xs" onClick={() => onEdit(p)}>Edit</button>
                          <button className="btn btn-danger  !py-1 !px-2 text-xs" onClick={() => onDelete(p)}>Delete</button>
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
        <ProductForm
          categories={cats}
          editing={editing}
          onCancel={() => { setEditing(null); setTab("list"); }}
          onSaved={() => { setEditing(null); setTab("list"); }}
        />
      )}
    </div>
  );
}
