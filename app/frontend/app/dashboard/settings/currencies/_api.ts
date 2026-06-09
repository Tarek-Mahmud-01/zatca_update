/**
 * Currencies feature API. Owned here; the exchange-rates page and the invoice
 * editor import `currenciesApi` from this module.
 */
import { request, del } from "@/lib/api/client";

export interface TenantCurrency {
  id: string;
  code: string;                  // ISO 4217
  exchange_rate: string;         // "1 unit code = exchange_rate units of base"; string for precision
  as_of_date: string;            // ISO yyyy-mm-dd
  is_default: boolean;
}

type CurrencyBody = { code: string; exchange_rate: string; as_of_date?: string; is_default?: boolean };

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
