"use client";

import { useEffect } from "react";
import { useBranchesDispatch, useBranchesSelector } from "../store/branches.store";
import { fetchAll } from "../store/branches.thunks";
import { branchSelectors } from "../store/branches.selectors";

/** Subscribe to the branches store; auto-fetches once on first mount. */
export function useBranches() {
  const dispatch = useBranchesDispatch();
  const items = useBranchesSelector(branchSelectors.selectAll);
  const meta = useBranchesSelector((s) => s.branches);
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
