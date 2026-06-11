"use client";

import { useEffect } from "react";
import { useCustomersDispatch, useCustomersSelector } from "../store/customers.store";
import { fetchAll } from "../store/customers.thunks";
import { customerSelectors } from "../store/customers.selectors";

/** Subscribe to the customers store; auto-fetches once on first mount. */
export function useCustomers() {
  const dispatch = useCustomersDispatch();
  const items = useCustomersSelector(customerSelectors.selectAll);
  const meta = useCustomersSelector((s) => s.customers);
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
