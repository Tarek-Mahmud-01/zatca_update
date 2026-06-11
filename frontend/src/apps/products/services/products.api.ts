import { request, del } from "@/apps/http/client";
import type { Product } from "../types/product.types";

export const productsApi = {
  listProducts(token: string, opts: { q?: string; category_id?: string } = {}) {
    const qs = new URLSearchParams();
    if (opts.q) qs.set("q", opts.q);
    if (opts.category_id) qs.set("category_id", opts.category_id);
    const tail = qs.toString();
    return request<Product[]>(`/api/v1/products${tail ? `?${tail}` : ""}`, { token });
  },
  getProduct(token: string, id: string) { return request<Product>(`/api/v1/products/${id}`, { token }); },
  createProduct(token: string, body: Partial<Product>) {
    return request<Product>("/api/v1/products", { method: "POST", body: JSON.stringify(body), token });
  },
  updateProduct(token: string, id: string, body: Partial<Product>) {
    return request<Product>(`/api/v1/products/${id}`, { method: "PATCH", body: JSON.stringify(body), token });
  },
  deleteProduct(token: string, id: string) { return del(token, `/api/v1/products/${id}`); },
};
