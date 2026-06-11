"use client";

import { configureStore } from "@reduxjs/toolkit";
import { useDispatch, useSelector, type TypedUseSelectorHook } from "react-redux";
import { categoriesReducer } from "./categories.slice";

export const categoriesStore = configureStore({ reducer: { categories: categoriesReducer } });

export type CategoriesRootState = ReturnType<typeof categoriesStore.getState>;
export type CategoriesDispatch = typeof categoriesStore.dispatch;

export const useCategoriesDispatch: () => CategoriesDispatch = useDispatch;
export const useCategoriesSelector: TypedUseSelectorHook<CategoriesRootState> = useSelector;
