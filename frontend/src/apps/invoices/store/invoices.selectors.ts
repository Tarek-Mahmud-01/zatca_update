"use client";

import { invoicesAdapter } from "./invoices.slice";
import type { InvoicesRootState } from "./invoices.store";

export const invoiceSel = invoicesAdapter.getSelectors(
  (s: InvoicesRootState) => s.invoices,
);
