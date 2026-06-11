"use client";

import { currenciesAdapter } from "./currencies.slice";
import type { CurrenciesRootState } from "./currencies.store";

export const currencySelectors = currenciesAdapter.getSelectors(
  (s: CurrenciesRootState) => s.currencies,
);
