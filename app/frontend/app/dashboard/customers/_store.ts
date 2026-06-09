"use client";

/**
 * Customers store slice + subscription hook (feature-owned). Built from the
 * generic CRUD factory and wired to this feature's `customersApi`.
 */
import { createCrudSlice } from "@/lib/store/crud";
import { makeEntityHook } from "@/lib/store/make-entity-hook";
import type { RootState } from "@/lib/store";
import { customersApi, type Customer } from "./_api";

export const customers = createCrudSlice<Customer>("customers", {
  list:   (t) => customersApi.listCustomers(t),
  create: (t, b) => customersApi.createCustomer(t, b),
  update: (t, id, b) => customersApi.updateCustomer(t, id, b),
  remove: (t, id) => customersApi.deleteCustomer(t, id),
});

const sel = customers.adapter.getSelectors((s: RootState) => s.customers);
export const useCustomers = makeEntityHook(sel.selectAll, "customers", customers.thunks.fetchAll);
