"use client";

import { branchesAdapter } from "./branches.slice";
import type { BranchesRootState } from "./branches.store";

export const branchSelectors = branchesAdapter.getSelectors(
  (s: BranchesRootState) => s.branches,
);
