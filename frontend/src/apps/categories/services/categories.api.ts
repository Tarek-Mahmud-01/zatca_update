import { request, del } from "@/apps/http/client";
import type { Category } from "../types/category.types";

export const categoriesApi = {
  listCategories(token: string) { return request<Category[]>("/api/v1/categories", { token }); },
  createCategory(token: string, body: Partial<Category>) {
    return request<Category>("/api/v1/categories", { method: "POST", body: JSON.stringify(body), token });
  },
  updateCategory(token: string, id: string, body: Partial<Category>) {
    return request<Category>(`/api/v1/categories/${id}`, { method: "PATCH", body: JSON.stringify(body), token });
  },
  deleteCategory(token: string, id: string) { return del(token, `/api/v1/categories/${id}`); },
};
