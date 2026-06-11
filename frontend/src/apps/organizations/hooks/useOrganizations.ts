"use client";

import { useEffect } from "react";
import { useOrganizationsDispatch, useOrganizationsSelector } from "../store/organizations.store";
import { fetchAll } from "../store/organizations.thunks";
import { organizationSelectors } from "../store/organizations.selectors";

/** Subscribe to the organizations store; auto-fetches once on first mount. */
export function useOrganizations() {
  const dispatch = useOrganizationsDispatch();
  const items = useOrganizationsSelector(organizationSelectors.selectAll);
  const meta = useOrganizationsSelector((s) => s.organizations);
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
