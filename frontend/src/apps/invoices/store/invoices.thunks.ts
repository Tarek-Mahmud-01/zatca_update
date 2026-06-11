"use client";

import { createAsyncThunk } from "@reduxjs/toolkit";
import { getToken } from "@/apps/auth/utils/token";
import { invoicesApi } from "../services/invoices.api";
import type { InvoiceListPage } from "../types/invoice.types";

export interface InvoiceListParams {
  page?: number;
  page_size?: number;
  statuses?: string[];
  date_from?: string;
  date_to?: string;
  q?: string;
}

export const fetchInvoices = createAsyncThunk<
  InvoiceListPage, InvoiceListParams, { rejectValue: string }
>("invoices/fetch", async (params, { rejectWithValue }) => {
  const token = getToken();
  if (!token) return rejectWithValue("not_authenticated");
  try { return await invoicesApi.listInvoices(token, params); }
  catch (e) { return rejectWithValue(String(e)); }
});
