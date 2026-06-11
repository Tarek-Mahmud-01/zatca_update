"use client";

import { usersAdapter } from "./users.slice";
import type { UsersRootState } from "./users.store";

export const userSelectors = usersAdapter.getSelectors(
  (s: UsersRootState) => s.tenantUsers,
);
