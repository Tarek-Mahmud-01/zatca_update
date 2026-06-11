"use client";

import { configureStore } from "@reduxjs/toolkit";
import { useDispatch, useSelector, type TypedUseSelectorHook } from "react-redux";
import { customersReducer } from "./customers.slice";

// Independent per-feature store (no global Redux).
export const customersStore = configureStore({ reducer: { customers: customersReducer } });

export type CustomersRootState = ReturnType<typeof customersStore.getState>;
export type CustomersDispatch = typeof customersStore.dispatch;

export const useCustomersDispatch: () => CustomersDispatch = useDispatch;
export const useCustomersSelector: TypedUseSelectorHook<CustomersRootState> = useSelector;
