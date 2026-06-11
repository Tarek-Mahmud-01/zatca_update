"use client";

import { useEffect } from "react";
import { Provider } from "react-redux";
import { sessionStore, sessionActions } from "./session";

/** Mounts the independent session store. Placed once in the dashboard layout
 * so `useMe()` works for the header and every page. Resets stale profile data
 * on every mount so that re-login always fetches a fresh /auth/me. */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // The sessionStore is a module-level singleton that survives React
    // unmount/remount cycles. Reset it here so that after logout + re-login
    // the dashboard always fetches a fresh profile instead of reusing the
    // previous session's cached `me`.
    sessionStore.dispatch(sessionActions.reset());
  }, []);
  return <Provider store={sessionStore}>{children}</Provider>;
}
