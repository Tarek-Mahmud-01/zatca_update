/**
 * Currencies feature API. Owned here; the exchange-rates page and the invoice
 * editor import `currenciesApi` from this module.
 */
import { request, del } from "@/apps/http/client";
import type { TenantCurrency, CurrencyBody } from "../types/currency.types";

export const currenciesApi = {
  listCurrencies(token: string) {
    return request<TenantCurrency[]>("/api/v1/settings/currencies", { token });
  },
  createCurrency(token: string, body: CurrencyBody) {
    return request<TenantCurrency>("/api/v1/settings/currencies", {
      method: "POST", body: JSON.stringify(body), token,
    });
  },
  updateCurrency(token: string, id: string, body: CurrencyBody) {
    return request<TenantCurrency>(`/api/v1/settings/currencies/${id}`, {
      method: "PATCH", body: JSON.stringify(body), token,
    });
  },
  deleteCurrency(token: string, id: string) { return del(token, `/api/v1/settings/currencies/${id}`); },
};
