"use client";

/**
 * Categories store slice + subscription hook (feature-owned). The products
 * feature imports `useCategories` from here for its category picker.
 */
import { createCrudSlice } from "@/lib/store/crud";
import { makeEntityHook } from "@/lib/store/make-entity-hook";
import type { RootState } from "@/lib/store";
import { categoriesApi, type Category } from "./_api";

export const categories = createCrudSlice<Category>("categories", {
  list:   (t) => categoriesApi.listCategories(t),
  create: (t, b) => categoriesApi.createCategory(t, b),
  update: (t, id, b) => categoriesApi.updateCategory(t, id, b),
  remove: (t, id) => categoriesApi.deleteCategory(t, id),
});

const sel = categories.adapter.getSelectors((s: RootState) => s.categories);
export const useCategories = makeEntityHook(sel.selectAll, "categories", categories.thunks.fetchAll);
