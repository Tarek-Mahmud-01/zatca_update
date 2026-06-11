"use client";

import { configureStore } from "@reduxjs/toolkit";
import { useDispatch, useSelector, type TypedUseSelectorHook } from "react-redux";
import { branchesReducer } from "./branches.slice";

// Independent per-feature store (no global Redux).
export const branchesStore = configureStore({ reducer: { branches: branchesReducer } });

export type BranchesRootState = ReturnType<typeof branchesStore.getState>;
export type BranchesDispatch = typeof branchesStore.dispatch;

export const useBranchesDispatch: () => BranchesDispatch = useDispatch;
export const useBranchesSelector: TypedUseSelectorHook<BranchesRootState> = useSelector;
