"use client";

/**
 * Store assembly (global infra).
 *
 * Each entity slice now LIVES with its feature (app/<feature>/_store.ts). This
 * module only imports their reducers, builds the single global store, and
 * exposes the shared pieces: the store, the RootState/AppDispatch types, the
 * typed hooks (re-exported from ./hooks), and the app-wide session hook.
 *
 * Feature pages import their own slice + `useThing()` from their `_store.ts`
 * (or a sibling feature's, for cross-feature reads) — not from here.
 */
import { configureStore } from "@reduxjs/toolkit";
import { useEffect } from "react";
import { useAppDispatch, useAppSelector } from "./hooks";
import { sessionReducer, sessionActions, fetchMe } from "./session";

import { customers } from "@/app/dashboard/customers/_store";
import { products } from "@/app/dashboard/products/_store";
import { categories } from "@/app/dashboard/categories/_store";
import { currencies } from "@/app/dashboard/settings/currencies/_store";
import { organizations } from "@/app/dashboard/settings/organizations/_store";
import { branches } from "@/app/dashboard/settings/branches/_store";
import { tenantUsers } from "@/app/dashboard/settings/users/_store";
import { invoicesReducer } from "@/app/dashboard/invoices/_store";

// Shared re-exports so consumers have one import for the common pieces.
export { useAppDispatch, useAppSelector } from "./hooks";
export { sessionActions, fetchMe };

// ---- the single global store ----------------------------------------------
export const store = configureStore({
  reducer: {
    customers: customers.reducer,
    products: products.reducer,
    categories: categories.reducer,
    currencies: currencies.reducer,
    organizations: organizations.reducer,
    branches: branches.reducer,
    tenantUsers: tenantUsers.reducer,
    invoices: invoicesReducer,
    session: sessionReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

/**
 * Current user, fetched once for the whole app. First consumer triggers the
 * fetch; the rest read from the store. Shared infra — lives here, not in a
 * feature, because every feature's chrome uses it.
 */
export function useMe() {
  const dispatch = useAppDispatch();
  const me = useAppSelector((s) => s.session.me);
  const loading = useAppSelector((s) => s.session.loading);
  const loaded = useAppSelector((s) => s.session.loaded);
  const error = useAppSelector((s) => s.session.error);
  useEffect(() => {
    if (!loaded && !loading) dispatch(fetchMe());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { me, loading, loaded, error };
}
