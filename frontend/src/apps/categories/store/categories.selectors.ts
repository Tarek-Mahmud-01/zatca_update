"use client";

import { categoriesAdapter } from "./categories.slice";
import type { CategoriesRootState } from "./categories.store";

export const categorySelectors = categoriesAdapter.getSelectors(
  (s: CategoriesRootState) => s.categories,
);
