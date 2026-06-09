"use client";

/**
 * Invoices store slice (feature-owned) — paginated, so it can't use the plain
 * CRUD factory.
 *
 * - fetchInvoices(params)  → setAll(page items) + pagination meta
 * - patchStatus({id,status}) → mutate one row's status in place (driven by the
 *   SSE stream / after a submit, so the list reflects lifecycle changes without
 *   a refetch)
 * - removeInvoice(id)      → drop a row
 */
import { createAsyncThunk, createEntityAdapter, createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { getToken } from "@/lib/token";
import type { RootState } from "@/lib/store";
import { invoicesApi, type InvoiceListItem, type InvoiceListPage } from "./_api";

export interface InvoiceListParams {
  page?: number;
  page_size?: number;
  statuses?: string[];
  date_from?: string;
  date_to?: string;
  q?: string;
}

const adapter = createEntityAdapter<InvoiceListItem, string>({ selectId: (i) => i.id });

export const fetchInvoices = createAsyncThunk<
  InvoiceListPage, InvoiceListParams, { rejectValue: string }
>("invoices/fetch", async (params, { rejectWithValue }) => {
  const token = getToken();
  if (!token) return rejectWithValue("not_authenticated");
  try { return await invoicesApi.listInvoices(token, params); }
  catch (e) { return rejectWithValue(String(e)); }
});

const slice = createSlice({
  name: "invoices",
  initialState: adapter.getInitialState({
    loading: false,
    loaded: false,
    error: null as string | null,
    page: 1,
    pageSize: 25,
    total: 0,
    totalPages: 1,
  }),
  reducers: {
    // Status push from the SSE stream / after a submit. Only touches rows we
    // currently hold (the visible page); unknown ids are ignored.
    patchStatus(state, action: PayloadAction<{ id: string; status: string }>) {
      const cur = state.entities[action.payload.id];
      if (cur) adapter.upsertOne(state, { ...cur, status: action.payload.status });
    },
    upsertInvoice(state, action: PayloadAction<InvoiceListItem>) {
      adapter.upsertOne(state, action.payload);
    },
    removeInvoice(state, action: PayloadAction<string>) {
      adapter.removeOne(state, action.payload);
    },
  },
  extraReducers: (b) => {
    b.addCase(fetchInvoices.pending, (s) => { s.loading = true; s.error = null; });
    b.addCase(fetchInvoices.fulfilled, (s, a) => {
      s.loading = false;
      s.loaded = true;
      adapter.setAll(s, a.payload.items);
      s.page = a.payload.page;
      s.pageSize = a.payload.page_size;
      s.total = a.payload.total;
      s.totalPages = a.payload.total_pages;
    });
    b.addCase(fetchInvoices.rejected, (s, a) => {
      s.loading = false;
      s.error = a.payload ?? a.error.message ?? "load_failed";
    });
  },
});

export const invoicesReducer = slice.reducer;
export const invoicesActions = slice.actions;
export const invoicesAdapter = adapter;
export const invoiceSel = adapter.getSelectors((s: RootState) => s.invoices);
