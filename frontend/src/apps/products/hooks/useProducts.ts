"use client";

import { useEffect } from "react";
import { useProductsDispatch, useProductsSelector } from "../store/products.store";
import { fetchAll } from "../store/products.thunks";
import { productSelectors } from "../store/products.selectors";

/** Subscribe to the products store; auto-fetches once on first mount. */
export function useProducts() {
  const dispatch = useProductsDispatch();
  const items = useProductsSelector(productSelectors.selectAll);
  const meta = useProductsSelector((s) => s.products);
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
