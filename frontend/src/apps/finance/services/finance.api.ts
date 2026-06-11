import { request } from "@/apps/http/client";
import type { Currency, CurrencyCreate, ExchangeRate, ExchangeRateCreate } from "../types/finance.types";

export const financeApi = {
  listCurrencies: () => request<Currency[]>("/finance/currencies"),
  createCurrency: (data: CurrencyCreate) =>
    request<Currency>("/finance/currencies", { method: "POST", body: JSON.stringify(data) }),
  setDefault: (id: string) =>
    request<Currency>(`/finance/currencies/${id}/default`, { method: "POST" }),
  listRates: (params?: { currency_id?: string; limit?: number; offset?: number }) => {
    const qs = params ? "?" + new URLSearchParams(
      Object.fromEntries(
        Object.entries(params)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, String(v)])
      )
    ).toString() : "";
    return request<{ items: ExchangeRate[]; total: number }>(`/finance/exchange-rates${qs}`);
  },
  createRate: (data: ExchangeRateCreate) =>
    request<ExchangeRate>("/finance/exchange-rates", { method: "POST", body: JSON.stringify(data) }),
};
