export interface Currency {
  id: string;
  code: string;
  name: string;
  is_default: boolean;
  created_at: string;
}

export interface ExchangeRate {
  id: string;
  rate: string;
  as_of_date: string;
  currency: { id: string; code: string };
}

export interface CurrencyCreate {
  code: string;
  name: string;
  is_default: boolean;
}

export interface ExchangeRateCreate {
  currency_id: string;
  rate: string;
  as_of_date: string;
}
