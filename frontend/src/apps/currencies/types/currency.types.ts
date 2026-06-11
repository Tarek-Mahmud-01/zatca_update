export interface TenantCurrency {
  id: string;
  code: string;                  // ISO 4217
  exchange_rate: string;         // "1 unit code = exchange_rate units of base"; string for precision
  as_of_date: string;            // ISO yyyy-mm-dd
  is_default: boolean;
}

export type CurrencyBody = {
  code: string;
  exchange_rate: string;
  as_of_date?: string;
  is_default?: boolean;
};
