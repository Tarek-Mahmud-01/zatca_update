"use client";

import { productsAdapter } from "./products.slice";
import type { ProductsRootState } from "./products.store";

export const productSelectors = productsAdapter.getSelectors(
  (s: ProductsRootState) => s.products,
);
