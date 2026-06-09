"use client";

/**
 * Session slice — the current user's profile (`/auth/me`), fetched ONCE and
 * shared everywhere via `useMe()`. Before this, ~9 components each fetched
 * `api.me()` on mount; now the first consumer triggers a single fetch and the
 * rest read from the store.
 *
 * Stale-data-across-sessions is handled at the navigation layer, not here:
 * `handleAuthExpired()` (lib/token) logs out via `window.location.replace`, a
 * HARD navigation that tears down the JS context and this module-singleton
 * store with it — the next user starts from `initialState`. `reset()` is kept
 * for any future soft (in-place) logout that needs to clear state without a
 * full reload.
 */
import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { authApi, type Me } from "../api/auth";
import { getToken } from "../token";

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
  reducers: {
    reset: () => initialState,
  },
  extraReducers: (b) => {
    b.addCase(fetchMe.pending, (s) => { s.loading = true; s.error = null; });
    b.addCase(fetchMe.fulfilled, (s, a) => { s.loading = false; s.loaded = true; s.me = a.payload; });
    b.addCase(fetchMe.rejected, (s, a) => { s.loading = false; s.loaded = true; s.error = a.payload ?? "error"; });
  },
});

export const sessionReducer = slice.reducer;
export const sessionActions = slice.actions;
