"use client";

import { configureStore } from "@reduxjs/toolkit";
import { useDispatch, useSelector, type TypedUseSelectorHook } from "react-redux";
import { productsReducer } from "./products.slice";

export const productsStore = configureStore({ reducer: { products: productsReducer } });

export type ProductsRootState = ReturnType<typeof productsStore.getState>;
export type ProductsDispatch = typeof productsStore.dispatch;

export const useProductsDispatch: () => ProductsDispatch = useDispatch;
export const useProductsSelector: TypedUseSelectorHook<ProductsRootState> = useSelector;
