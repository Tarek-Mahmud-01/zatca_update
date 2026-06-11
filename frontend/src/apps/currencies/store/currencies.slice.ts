"use client";

import { createCrudSlice } from "@/apps/redux-kit/crud";
import { currenciesApi } from "../services/currencies.api";
import type { TenantCurrency, CurrencyBody } from "../types/currency.types";

export const currenciesCrud = createCrudSlice<TenantCurrency, CurrencyBody, CurrencyBody>("currencies", {
  list:   (t) => currenciesApi.listCurrencies(t),
  create: (t, b) => currenciesApi.createCurrency(t, b),
  update: (t, id, b) => currenciesApi.updateCurrency(t, id, b),
  remove: (t, id) => currenciesApi.deleteCurrency(t, id),
});

export const currenciesReducer = currenciesCrud.reducer;
export const currenciesActions = currenciesCrud.actions;
export const currenciesAdapter = currenciesCrud.adapter;
