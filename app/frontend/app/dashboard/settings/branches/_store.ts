"use client";

/**
 * Branches store slice + subscription hook (feature-owned). The users page and
 * the invoice editor import `useBranches` / `branches` here.
 */
import { createCrudSlice } from "@/lib/store/crud";
import { makeEntityHook } from "@/lib/store/make-entity-hook";
import type { RootState } from "@/lib/store";
import { branchesApi, type TenantBranch } from "./_api";

type BranchBody = Partial<TenantBranch> & { organization_id: string };

export const branches = createCrudSlice<TenantBranch, BranchBody, BranchBody>("branches", {
  list:   (t) => branchesApi.listBranches(t),
  create: (t, b) => branchesApi.createBranch(t, b),
  update: (t, id, b) => branchesApi.updateBranch(t, id, b),
  remove: (t, id) => branchesApi.deleteBranch(t, id),
});

const sel = branches.adapter.getSelectors((s: RootState) => s.branches);
export const useBranches = makeEntityHook(sel.selectAll, "branches", branches.thunks.fetchAll);
