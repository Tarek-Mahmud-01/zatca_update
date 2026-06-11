"use client";

import { useState } from "react";
import { Banner, Card, Field, FieldGrid } from "@/app/core/components/ui";
import { useCategoriesDispatch } from "../store/categories.store";
import { createOne, updateOne } from "../store/categories.thunks";
import type { Category } from "../types/category.types";

export function CategoryForm({
  editing, onCancel, onSaved,
}: { editing: Category | null; onCancel: () => void; onSaved: () => void }) {
  const dispatch = useCategoriesDispatch();
  const [name, setName] = useState(editing?.name ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (editing) await dispatch(updateOne({ id: editing.id, body: { name, description } })).unwrap();
      else         await dispatch(createOne({ name, description })).unwrap();
      onSaved();
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
