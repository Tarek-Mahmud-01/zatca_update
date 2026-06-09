/**
 * Products feature API. Owned here; the invoice editor's line-item picker
 * imports `productsApi` from this module.
 */
import { request, del } from "@/lib/api/client";

export interface Product {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  category_id: string | null;
  category_name: string | null;
  unit_price: string;
  unit_code: string;
  tax_category: "S" | "Z" | "E" | "O" | "G";
  tax_percent: string;
}

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
