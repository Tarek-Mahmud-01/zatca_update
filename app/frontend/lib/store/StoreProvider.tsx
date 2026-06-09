"use client";

import { Provider } from "react-redux";
import { store } from "./index";

/** Wraps the dashboard subtree so every page can read/dispatch the Redux store. */
export function StoreProvider({ children }: { children: React.ReactNode }) {
  return <Provider store={store}>{children}</Provider>;
}
