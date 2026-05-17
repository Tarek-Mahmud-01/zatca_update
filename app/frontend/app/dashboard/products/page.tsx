"use client";

import { useEffect, useMemo, useState } from "react";
import { api, type Category, type Product } from "../../../lib/api-client";
import { getToken } from "../../../lib/token";
import { Banner, Card, Empty, Field, FieldGrid, PageHeader, Tabs } from "../../../components/ui";
import { VAT_CATEGORIES } from "../../../lib/catalog";

type TabId = "list" | "add";

export default function ProductsPage() {
  const [tab, setTab] = useState<TabId>("list");
  const [rows, setRows] = useState<Product[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [editing, setEditing] = useState<Product | null>(null);
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const token = getToken();
    if (!token) return;
    setLoading(true);
    try {
      const [products, categories] = await Promise.all([
        api.listProducts(token, { q: search || undefined, category_id: filterCat || undefined }),
        api.listCategories(token),
      ]);
      setRows(products);
      setCats(categories);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [search, filterCat]);

  function onEdit(p: Product) {
    setEditing(p);
    setTab("add");
  }

  async function onDelete(p: Product) {
    if (!confirm(`Delete product "${p.name}"?`)) return;
    const token = getToken();
    if (!token) return;
    try {
      await api.deleteProduct(token, p.id);
      await reload();
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

      {error && <div className="mb-4"><Banner tone="danger">{error}</Banner></div>}

      {tab === "list" && (
        <>
          <div className="flex flex-col sm:flex-row gap-2 mb-4">
            <input
              className="input sm:max-w-xs"
              placeholder="Search SKU or name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              className="input sm:max-w-xs"
              value={filterCat}
              onChange={(e) => setFilterCat(e.target.value)}
            >
              <option value="">All categories</option>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
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
          onSaved={async () => { setEditing(null); await reload(); setTab("list"); }}
        />
      )}
    </div>
  );
}

function ProductForm({
  categories, editing, onCancel, onSaved,
}: {
  categories: Category[];
  editing: Product | null;
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [form, setForm] = useState({
    sku:          editing?.sku ?? "",
    name:         editing?.name ?? "",
    description:  editing?.description ?? "",
    category_id:  editing?.category_id ?? "",
    unit_price:   editing?.unit_price ?? "0.00",
    unit_code:    editing?.unit_code ?? "PCE",
    tax_category: editing?.tax_category ?? "S",
    tax_percent:  editing?.tax_percent ?? "15",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedVat = useMemo(() => VAT_CATEGORIES.find((v) => v.code === form.tax_category), [form.tax_category]);

  function upd<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const token = getToken();
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const body = {
        ...form,
        category_id: form.category_id || null,
        unit_price:  form.unit_price,
        tax_percent: form.tax_percent,
      };
      if (editing) await api.updateProduct(token, editing.id, body as never);
      else         await api.createProduct(token, body as never);
      await onSaved();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={editing ? "Edit product" : "New product"}>
      <form onSubmit={submit} className="flex flex-col gap-5">
        <FieldGrid cols={2}>
          <Field label="SKU" required hint="Unique stock-keeping unit code">
            <input className="input" value={form.sku} onChange={(e) => upd("sku", e.target.value)} required maxLength={64} />
          </Field>
          <Field label="Name" required>
            <input className="input" value={form.name} onChange={(e) => upd("name", e.target.value)} required maxLength={200} />
          </Field>
        </FieldGrid>

        <Field label="Description" hint="Optional, shown in line-item description on invoices.">
          <textarea
            className="input min-h-[80px]"
            value={form.description ?? ""}
            onChange={(e) => upd("description", e.target.value)}
          />
        </Field>

        <FieldGrid cols={3}>
          <Field label="Category">
            <select className="input" value={form.category_id ?? ""} onChange={(e) => upd("category_id", e.target.value)}>
              <option value="">— Uncategorized —</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Unit price (SAR)" required>
            <input className="input tabular-nums" inputMode="decimal" value={form.unit_price} onChange={(e) => upd("unit_price", e.target.value)} required />
          </Field>
          <Field label="Unit code" hint="UN/ECE Rec.20 — PCE, KGM, MTR, HUR…">
            <input className="input" value={form.unit_code} onChange={(e) => upd("unit_code", e.target.value)} maxLength={8} />
          </Field>
        </FieldGrid>

        <FieldGrid cols={2}>
          <Field label="VAT category" hint={selectedVat?.hint}>
            <select
              className="input"
              value={form.tax_category}
              onChange={(e) => {
                const code = e.target.value as typeof form.tax_category;
                const cat = VAT_CATEGORIES.find((v) => v.code === code);
                upd("tax_category", code);
                if (cat) upd("tax_percent", String(cat.defaultPercent));
              }}
            >
              {VAT_CATEGORIES.map((v) => (
                <option key={v.code} value={v.code}>{v.code} — {v.label}</option>
              ))}
            </select>
          </Field>
          <Field label="VAT percent">
            <input className="input tabular-nums" inputMode="decimal" value={form.tax_percent} onChange={(e) => upd("tax_percent", e.target.value)} />
          </Field>
        </FieldGrid>

        {error && <Banner tone="danger">{error}</Banner>}

        <div className="flex gap-2">
          <button className="btn btn-primary" disabled={busy} type="submit">
            {busy ? "Saving…" : editing ? "Save changes" : "Create product"}
          </button>
          <button className="btn btn-default" type="button" onClick={onCancel}>Cancel</button>
        </div>
      </form>
    </Card>
  );
}
