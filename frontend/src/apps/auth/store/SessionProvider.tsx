"use client";

import { Provider } from "react-redux";
import { sessionStore } from "./session";

/** Mounts the independent session store. Placed once in the dashboard layout
 * so `useMe()` works for the header and every page. */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  return <Provider store={sessionStore}>{children}</Provider>;
}
