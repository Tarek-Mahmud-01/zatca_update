"use client";

import { configureStore } from "@reduxjs/toolkit";
import { useDispatch, useSelector, type TypedUseSelectorHook } from "react-redux";
import { usersReducer } from "./users.slice";

// Independent per-feature store (no global Redux). The slice key stays
// `tenantUsers` to match the entity name.
export const usersStore = configureStore({ reducer: { tenantUsers: usersReducer } });

export type UsersRootState = ReturnType<typeof usersStore.getState>;
export type UsersDispatch = typeof usersStore.dispatch;

export const useUsersDispatch: () => UsersDispatch = useDispatch;
export const useUsersSelector: TypedUseSelectorHook<UsersRootState> = useSelector;
