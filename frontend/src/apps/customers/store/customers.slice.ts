"use client";

import { createCrudSlice } from "@/apps/redux-kit/crud";
import { customersApi } from "../services/customers.api";
import type { Customer } from "../types/customer.types";

export const customersCrud = createCrudSlice<Customer>("customers", {
  list:   (t) => customersApi.listCustomers(t),
  create: (t, b) => customersApi.createCustomer(t, b),
  update: (t, id, b) => customersApi.updateCustomer(t, id, b),
  remove: (t, id) => customersApi.deleteCustomer(t, id),
});

export const customersReducer = customersCrud.reducer;
export const customersActions = customersCrud.actions;
export const customersAdapter = customersCrud.adapter;
