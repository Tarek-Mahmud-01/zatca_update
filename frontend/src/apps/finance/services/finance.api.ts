import { request } from "@/apps/http/client";
import type { Currency, CurrencyCreate, ExchangeRate, ExchangeRateCreate } from "../types/finance.types";

export const financeApi = {
  listCurrencies: (token: string) =>
    request<Currency[]>("/api/v1/finance/currencies", { token }),

  createCurrency: (token: string, data: CurrencyCreate) =>
    request<Currency>("/api/v1/finance/currencies", {
      method: "POST", body: JSON.stringify(data), token,
    }),

  setDefault: (token: string, id: string) =>
    request<Currency>(`/api/v1/finance/currencies/${id}/default`, { method: "POST", token }),

  listRates: (token: string, params?: { currency_id?: string; limit?: number; offset?: number }) => {
    const qs = params ? "?" + new URLSearchParams(
      Object.fromEntries(
        Object.entries(params)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, String(v)])
      )
    ).toString() : "";
    return request<{ items: ExchangeRate[]; total: number }>(`/api/v1/finance/exchange-rates${qs}`, { token });
  },

  createRate: (token: string, data: ExchangeRateCreate) =>
    request<ExchangeRate>("/api/v1/finance/exchange-rates", {
      method: "POST", body: JSON.stringify(data), token,
    }),
};
