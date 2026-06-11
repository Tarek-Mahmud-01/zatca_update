"use client";

import { configureStore } from "@reduxjs/toolkit";
import { useDispatch, useSelector, type TypedUseSelectorHook } from "react-redux";
import { currenciesReducer } from "./currencies.slice";

// Independent per-feature store (no global Redux).
export const currenciesStore = configureStore({ reducer: { currencies: currenciesReducer } });

export type CurrenciesRootState = ReturnType<typeof currenciesStore.getState>;
export type CurrenciesDispatch = typeof currenciesStore.dispatch;

export const useCurrenciesDispatch: () => CurrenciesDispatch = useDispatch;
export const useCurrenciesSelector: TypedUseSelectorHook<CurrenciesRootState> = useSelector;
