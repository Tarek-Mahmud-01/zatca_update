"use client";

/**
 * Typed Redux hooks, split out of ./index so feature `_store.ts` files can use
 * them WITHOUT importing the store barrel at runtime (which would create a
 * cycle: index → feature/_store → index). The RootState/AppDispatch types are
 * imported type-only and erased at compile time.
 */
import { useDispatch, useSelector, type TypedUseSelectorHook } from "react-redux";
import type { RootState, AppDispatch } from "./index";

export const useAppDispatch = () => useDispatch<AppDispatch>();
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
