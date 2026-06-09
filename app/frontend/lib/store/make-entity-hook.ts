"use client";

/**
 * Factory for a per-entity subscription hook. A feature calls this in its
 * `_store.ts` to expose `useThing()` — auto-fetches once on first mount (unless
 * already loaded), then returns the live list + status. `refetch` forces a
 * reload. Lives outside ./index to keep feature stores free of a runtime
 * dependency on the store barrel (RootState is imported type-only).
 */
import { useEffect } from "react";
import { useAppDispatch, useAppSelector } from "./hooks";
import type { RootState } from "./index";

export function makeEntityHook<T>(
  selectAll: (s: RootState) => T[],
  sliceKey: keyof RootState,
  // RTK's AsyncThunk config generic is invariant, so the per-entity thunks
  // don't unify under one parameter type — accept the creator loosely; dispatch
  // (typed AppDispatch) still validates the call at runtime.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fetchAll: (...args: any[]) => any,
) {
  return function useEntity() {
    const dispatch = useAppDispatch();
    const items = useAppSelector(selectAll);
    const meta = useAppSelector((s) => s[sliceKey] as { loading: boolean; loaded: boolean; error: string | null });
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
  };
}
