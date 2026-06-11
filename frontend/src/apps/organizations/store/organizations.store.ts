"use client";

import { configureStore } from "@reduxjs/toolkit";
import { useDispatch, useSelector, type TypedUseSelectorHook } from "react-redux";
import { organizationsReducer } from "./organizations.slice";

// Independent per-feature store (no global Redux).
export const organizationsStore = configureStore({ reducer: { organizations: organizationsReducer } });

export type OrganizationsRootState = ReturnType<typeof organizationsStore.getState>;
export type OrganizationsDispatch = typeof organizationsStore.dispatch;

export const useOrganizationsDispatch: () => OrganizationsDispatch = useDispatch;
export const useOrganizationsSelector: TypedUseSelectorHook<OrganizationsRootState> = useSelector;
