import { request, del } from "@/apps/http/client";
import type { Customer } from "../types/customer.types";

export const customersApi = {
  listCustomers(token: string, q?: string) {
    return request<Customer[]>(`/api/v1/customers${q ? `?q=${encodeURIComponent(q)}` : ""}`, { token });
  },
  getCustomer(token: string, id: string) { return request<Customer>(`/api/v1/customers/${id}`, { token }); },
  createCustomer(token: string, body: Partial<Customer>) {
    return request<Customer>("/api/v1/customers", { method: "POST", body: JSON.stringify(body), token });
  },
  updateCustomer(token: string, id: string, body: Partial<Customer>) {
    return request<Customer>(`/api/v1/customers/${id}`, { method: "PATCH", body: JSON.stringify(body), token });
  },
  deleteCustomer(token: string, id: string) { return del(token, `/api/v1/customers/${id}`); },
};
