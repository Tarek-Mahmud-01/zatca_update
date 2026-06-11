"use client";

import { createCrudSlice } from "@/apps/redux-kit/crud";
import { productsApi } from "../services/products.api";
import type { Product } from "../types/product.types";

export const productsCrud = createCrudSlice<Product>("products", {
  list:   (t) => productsApi.listProducts(t),
  create: (t, b) => productsApi.createProduct(t, b),
  update: (t, id, b) => productsApi.updateProduct(t, id, b),
  remove: (t, id) => productsApi.deleteProduct(t, id),
});

export const productsReducer = productsCrud.reducer;
export const productsActions = productsCrud.actions;
export const productsAdapter = productsCrud.adapter;
