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
import { createEntityAdapter, createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { fetchInvoices } from "./invoices.thunks";
import type { InvoiceListItem } from "../types/invoice.types";

const adapter = createEntityAdapter<InvoiceListItem, string>({ selectId: (i) => i.id });

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
