"use client";

/**
 * Products store slice + subscription hook (feature-owned).
 */
import { createCrudSlice } from "@/lib/store/crud";
import { makeEntityHook } from "@/lib/store/make-entity-hook";
import type { RootState } from "@/lib/store";
import { productsApi, type Product } from "./_api";

export const products = createCrudSlice<Product>("products", {
  list:   (t) => productsApi.listProducts(t),
  create: (t, b) => productsApi.createProduct(t, b),
  update: (t, id, b) => productsApi.updateProduct(t, id, b),
  remove: (t, id) => productsApi.deleteProduct(t, id),
});

const sel = products.adapter.getSelectors((s: RootState) => s.products);
export const useProducts = makeEntityHook(sel.selectAll, "products", products.thunks.fetchAll);
