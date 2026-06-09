/**
 * Customers feature API. Owned here; the invoice editor imports `customersApi`
 * from this module when it needs the customer list.
 */
import { request, del } from "@/lib/api/client";

export interface Customer {
  id: string;
  external_id: string | null;
  name: string;
  vat_number: string | null;
  crn: string | null;
  email: string | null;
  phone: string | null;
  street: string;
  building_number: string;
  city_subdivision: string;
  city: string;
  postal_zone: string;
  country_code: string;
}

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
