"use client";

import { createCrudSlice } from "@/apps/redux-kit/crud";
import { categoriesApi } from "../services/categories.api";
import type { Category } from "../types/category.types";

export const categoriesCrud = createCrudSlice<Category>("categories", {
  list:   (t) => categoriesApi.listCategories(t),
  create: (t, b) => categoriesApi.createCategory(t, b),
  update: (t, id, b) => categoriesApi.updateCategory(t, id, b),
  remove: (t, id) => categoriesApi.deleteCategory(t, id),
});

export const categoriesReducer = categoriesCrud.reducer;
export const categoriesActions = categoriesCrud.actions;
export const categoriesAdapter = categoriesCrud.adapter;
