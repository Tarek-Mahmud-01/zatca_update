"use client";

import { useEffect } from "react";
import { useUsersDispatch, useUsersSelector } from "../store/users.store";
import { fetchAll } from "../store/users.thunks";
import { userSelectors } from "../store/users.selectors";

/** Subscribe to the team-members store; auto-fetches once on first mount. */
export function useUsers() {
  const dispatch = useUsersDispatch();
  const items = useUsersSelector(userSelectors.selectAll);
  const meta = useUsersSelector((s) => s.tenantUsers);
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
