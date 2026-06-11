"use client";

import { useEffect } from "react";
import { useCurrenciesDispatch, useCurrenciesSelector } from "../store/currencies.store";
import { fetchAll } from "../store/currencies.thunks";
import { currencySelectors } from "../store/currencies.selectors";

/** Subscribe to the currencies store; auto-fetches once on first mount. */
export function useCurrencies() {
  const dispatch = useCurrenciesDispatch();
  const items = useCurrenciesSelector(currencySelectors.selectAll);
  const meta = useCurrenciesSelector((s) => s.currencies);
  useEffect(() => {
    if (!meta.loaded && !meta.loading) dispatch(fetchAll());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return {
    items,
    loading: meta.loading,
    loaded: meta.loaded,
    error: meta.error,
    refetch: () => dispatch(fetchAll()),
  };
}
