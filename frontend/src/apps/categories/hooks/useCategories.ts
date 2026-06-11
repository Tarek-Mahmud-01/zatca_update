"use client";

import { useEffect } from "react";
import { useCategoriesDispatch, useCategoriesSelector } from "../store/categories.store";
import { fetchAll } from "../store/categories.thunks";
import { categorySelectors } from "../store/categories.selectors";

/** Subscribe to the categories store; auto-fetches once on first mount. */
export function useCategories() {
  const dispatch = useCategoriesDispatch();
  const items = useCategoriesSelector(categorySelectors.selectAll);
  const meta = useCategoriesSelector((s) => s.categories);
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
