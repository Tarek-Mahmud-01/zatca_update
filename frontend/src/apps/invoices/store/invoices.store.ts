"use client";

import { configureStore } from "@reduxjs/toolkit";
import { useDispatch, useSelector, type TypedUseSelectorHook } from "react-redux";
import { invoicesReducer } from "./invoices.slice";

// Independent per-feature store (no global Redux).
export const invoicesStore = configureStore({ reducer: { invoices: invoicesReducer } });

export type InvoicesRootState = ReturnType<typeof invoicesStore.getState>;
export type InvoicesDispatch = typeof invoicesStore.dispatch;

export const useInvoicesDispatch: () => InvoicesDispatch = useDispatch;
export const useInvoicesSelector: TypedUseSelectorHook<InvoicesRootState> = useSelector;
