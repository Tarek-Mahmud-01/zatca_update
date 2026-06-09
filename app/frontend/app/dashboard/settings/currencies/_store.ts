"use client";

/**
 * Currencies store slice + subscription hook (feature-owned). The invoice
 * editor and exchange-rates page import `useCurrencies` / `currencies` here.
 */
import { createCrudSlice } from "@/lib/store/crud";
import { makeEntityHook } from "@/lib/store/make-entity-hook";
import type { RootState } from "@/lib/store";
import { currenciesApi, type TenantCurrency } from "./_api";

type CurrencyBody = { code: string; exchange_rate: string; as_of_date?: string; is_default?: boolean };

export const currencies = createCrudSlice<TenantCurrency, CurrencyBody, CurrencyBody>("currencies", {
  list:   (t) => currenciesApi.listCurrencies(t),
  create: (t, b) => currenciesApi.createCurrency(t, b),
  update: (t, id, b) => currenciesApi.updateCurrency(t, id, b),
  remove: (t, id) => currenciesApi.deleteCurrency(t, id),
});

const sel = currencies.adapter.getSelectors((s: RootState) => s.currencies);
export const useCurrencies = makeEntityHook(sel.selectAll, "currencies", currencies.thunks.fetchAll);
