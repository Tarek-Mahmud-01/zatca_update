"use client";

import { createCrudSlice } from "@/apps/redux-kit/crud";
import { branchesApi } from "../services/branches.api";
import type { TenantBranch, BranchBody } from "../types/branch.types";

export const branchesCrud = createCrudSlice<TenantBranch, BranchBody, BranchBody>("branches", {
  list:   (t) => branchesApi.listBranches(t),
  create: (t, b) => branchesApi.createBranch(t, b),
  update: (t, id, b) => branchesApi.updateBranch(t, id, b),
  remove: (t, id) => branchesApi.deleteBranch(t, id),
});

export const branchesReducer = branchesCrud.reducer;
export const branchesActions = branchesCrud.actions;
export const branchesAdapter = branchesCrud.adapter;
