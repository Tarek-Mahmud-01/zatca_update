"use client";

import { customersAdapter } from "./customers.slice";
import type { CustomersRootState } from "./customers.store";

export const customerSelectors = customersAdapter.getSelectors(
  (s: CustomersRootState) => s.customers,
);
