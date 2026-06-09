"use client";

import { configureStore } from "@reduxjs/toolkit";
import { useEffect } from "react";
import { useDispatch, useSelector, type TypedUseSelectorHook } from "react-redux";
import {
  api,
  type Category,
  type Customer,
  type Product,
  type TenantBranch,
  type TenantCurrency,
  type TenantOrganization,
  type TenantUser,
} from "../api-client";
import { createCrudSlice } from "./crud";
import { invoicesReducer, invoicesActions, invoicesAdapter, fetchInvoices, type InvoiceListParams } from "./invoices";

export { invoicesActions, fetchInvoices, type InvoiceListParams };

// ---- entity slices (one line each via the CRUD factory) -------------------

export const customers = createCrudSlice<Customer>("customers", {
  list:   (t) => api.listCustomers(t),
  create: (t, b) => api.createCustomer(t, b),
  update: (t, id, b) => api.updateCustomer(t, id, b),
  remove: (t, id) => api.deleteCustomer(t, id),
});

export const products = createCrudSlice<Product>("products", {
  list:   (t) => api.listProducts(t),
  create: (t, b) => api.createProduct(t, b),
  update: (t, id, b) => api.updateProduct(t, id, b),
  remove: (t, id) => api.deleteProduct(t, id),
});

export const categories = createCrudSlice<Category>("categories", {
  list:   (t) => api.listCategories(t),
  create: (t, b) => api.createCategory(t, b),
  update: (t, id, b) => api.updateCategory(t, id, b),
  remove: (t, id) => api.deleteCategory(t, id),
});

export const currencies = createCrudSlice<TenantCurrency, {
  code: string; exchange_rate: string; as_of_date?: string; is_default?: boolean;
}, {
  code: string; exchange_rate: string; as_of_date?: string; is_default?: boolean;
}>("currencies", {
  list:   (t) => api.listCurrencies(t),
  create: (t, b) => api.createCurrency(t, b),
  update: (t, id, b) => api.updateCurrency(t, id, b),
  remove: (t, id) => api.deleteCurrency(t, id),
});

export const organizations = createCrudSlice<TenantOrganization>("organizations", {
  list:   (t) => api.listOrganizations(t),
  create: (t, b) => api.createOrganization(t, b),
  update: (t, id, b) => api.updateOrganization(t, id, b),
  remove: (t, id) => api.deleteOrganization(t, id),
});

type BranchBody = Partial<TenantBranch> & { organization_id: string };
export const branches = createCrudSlice<TenantBranch, BranchBody, BranchBody>("branches", {
  list:   (t) => api.listBranches(t),
  create: (t, b) => api.createBranch(t, b),
  update: (t, id, b) => api.updateBranch(t, id, b),
  remove: (t, id) => api.deleteBranch(t, id),
});

type InviteBody = { email: string; password: string; role: string; default_branch_id?: string | null };
export const tenantUsers = createCrudSlice<TenantUser, InviteBody, never>("tenantUsers", {
  list:   (t) => api.listTenantUsers(t),
  create: (t, b) => api.inviteTenantUser(t, b),
  remove: (t, id) => api.removeTenantUser(t, id),
});

// ---- store ----------------------------------------------------------------

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
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export const useAppDispatch = () => useDispatch<AppDispatch>();
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;

// ---- per-entity selectors + convenience hooks -----------------------------

const customerSel     = customers.adapter.getSelectors((s: RootState) => s.customers);
const productSel      = products.adapter.getSelectors((s: RootState) => s.products);
const categorySel     = categories.adapter.getSelectors((s: RootState) => s.categories);
const currencySel     = currencies.adapter.getSelectors((s: RootState) => s.currencies);
const organizationSel = organizations.adapter.getSelectors((s: RootState) => s.organizations);
const branchSel       = branches.adapter.getSelectors((s: RootState) => s.branches);
const tenantUserSel   = tenantUsers.adapter.getSelectors((s: RootState) => s.tenantUsers);
export const invoiceSel = invoicesAdapter.getSelectors((s: RootState) => s.invoices);

/**
 * Subscribe to a CRUD slice. Auto-fetches once on first mount (unless already
 * loaded), then returns the live list + status. `refetch` forces a reload.
 */
function makeEntityHook<T>(
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

export const useCustomers     = makeEntityHook(customerSel.selectAll,     "customers",     customers.thunks.fetchAll);
export const useProducts      = makeEntityHook(productSel.selectAll,      "products",      products.thunks.fetchAll);
export const useCategories    = makeEntityHook(categorySel.selectAll,     "categories",    categories.thunks.fetchAll);
export const useCurrencies    = makeEntityHook(currencySel.selectAll,     "currencies",    currencies.thunks.fetchAll);
export const useOrganizations = makeEntityHook(organizationSel.selectAll, "organizations", organizations.thunks.fetchAll);
export const useBranches      = makeEntityHook(branchSel.selectAll,       "branches",      branches.thunks.fetchAll);
export const useTenantUsers   = makeEntityHook(tenantUserSel.selectAll,   "tenantUsers",   tenantUsers.thunks.fetchAll);
