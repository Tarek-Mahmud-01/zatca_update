"use client";

/**
 * Session store — the current user's profile (`/auth/me`) in its OWN
 * independent Redux store (no global store). Mounted once via SessionProvider
 * in the dashboard layout so any page/component can call `useMe()`.
 */
import { configureStore, createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { useEffect } from "react";
import { useDispatch, useSelector, type TypedUseSelectorHook } from "react-redux";
import { authApi, type Me } from "@/apps/auth/services/auth";
import { getToken } from "@/apps/auth/utils/token";

interface SessionState {
  me: Me | null;
  loading: boolean;
  loaded: boolean;
  error: string | null;
}

const initialState: SessionState = { me: null, loading: false, loaded: false, error: null };

export const fetchMe = createAsyncThunk<Me, void, { rejectValue: string }>(
  "session/fetchMe",
  async (_arg, { rejectWithValue }) => {
    const token = getToken();
    if (!token) return rejectWithValue("not_authenticated");
    try { return await authApi.me(token); }
    catch (e) { return rejectWithValue(String(e)); }
  },
);

const slice = createSlice({
  name: "session",
  initialState,
  reducers: { reset: () => initialState },
  extraReducers: (b) => {
    b.addCase(fetchMe.pending, (s) => { s.loading = true; s.error = null; });
    b.addCase(fetchMe.fulfilled, (s, a) => { s.loading = false; s.loaded = true; s.me = a.payload; });
    b.addCase(fetchMe.rejected, (s, a) => { s.loading = false; s.loaded = true; s.error = a.payload ?? "error"; });
  },
});

export const sessionStore = configureStore({ reducer: { session: slice.reducer } });
export type SessionRootState = ReturnType<typeof sessionStore.getState>;
export type SessionDispatch = typeof sessionStore.dispatch;
const useSessionDispatch: () => SessionDispatch = useDispatch;
const useSessionSelector: TypedUseSelectorHook<SessionRootState> = useSelector;
export const sessionActions = slice.actions;

/** Current user — first consumer triggers the single fetch; rest read state. */
export function useMe() {
  const dispatch = useSessionDispatch();
  const me = useSessionSelector((s) => s.session.me);
  const loading = useSessionSelector((s) => s.session.loading);
  const loaded = useSessionSelector((s) => s.session.loaded);
  const error = useSessionSelector((s) => s.session.error);
  useEffect(() => {
    if (!loaded && !loading) dispatch(fetchMe());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { me, loading, loaded, error };
}
