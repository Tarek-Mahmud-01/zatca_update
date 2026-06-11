"use client";

import { useMemo, useState } from "react";
import { Banner, Card, Field, FieldGrid } from "@/app/core/components/ui";
import { SearchSelect } from "@/app/core/components/SearchSelect";
import { VAT_CATEGORIES } from "@/app/core/constants/catalog";
import { useProductsDispatch } from "../store/products.store";
import { createOne, updateOne } from "../store/products.thunks";
import type { Product } from "../types/product.types";
import type { Category } from "@/apps/categories/types/category.types";

export function ProductForm({
  categories, editing, onCancel, onSaved,
}: {
  categories: Category[];
  editing: Product | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const dispatch = useProductsDispatch();
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
    setBusy(true);
    setError(null);
    try {
      const body = {
        ...form,
        category_id: form.category_id || null,
        unit_price:  form.unit_price,
        tax_percent: form.tax_percent,
      };
      if (editing) await dispatch(updateOne({ id: editing.id, body: body as never })).unwrap();
      else         await dispatch(createOne(body as never)).unwrap();
      onSaved();
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
          <textarea className="input min-h-[80px]" value={form.description ?? ""} onChange={(e) => upd("description", e.target.value)} />
        </Field>

        <FieldGrid cols={3}>
          <Field label="Category">
            <SearchSelect
              value={form.category_id ?? ""}
              onChange={(v) => upd("category_id", v)}
              placeholder="— Uncategorized —"
              options={categories.map((c) => ({ value: c.id, label: c.name }))}
              searchPlaceholder="Search categories…"
            />
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
            <SearchSelect
              value={form.tax_category}
              onChange={(code) => {
                const cat = VAT_CATEGORIES.find((v) => v.code === code);
                upd("tax_category", code as typeof form.tax_category);
                if (cat) upd("tax_percent", String(cat.defaultPercent));
              }}
              options={VAT_CATEGORIES.map((v) => ({ value: v.code, label: `${v.code} — ${v.label}` }))}
              searchPlaceholder="Search VAT categories…"
            />
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
