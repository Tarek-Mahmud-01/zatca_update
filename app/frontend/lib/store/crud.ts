"use client";

/**
 * Generic CRUD slice factory.
 *
 * Every entity that has a "list + create + update + delete" REST shape gets a
 * normalized Redux slice from this one helper, so the store mutates after each
 * action succeeds: fetch → setAll, create/update → upsertOne, delete →
 * removeOne. Pages dispatch the thunks and select from the store instead of
 * refetching after every change.
 */
import {
  createAsyncThunk,
  createEntityAdapter,
  createSlice,
  type EntityState,
  type PayloadAction,
} from "@reduxjs/toolkit";
import { getToken } from "../token";

export interface CrudExtra {
  loading: boolean;
  loaded: boolean;        // true once an initial fetch has completed
  error: string | null;
}
export type CrudState<T> = EntityState<T, string> & CrudExtra;

export interface CrudApi<T, C, U> {
  list: (token: string) => Promise<T[]>;
  create?: (token: string, body: C) => Promise<T>;
  update?: (token: string, id: string, body: U) => Promise<T>;
  remove?: (token: string, id: string) => Promise<void>;
}

export function createCrudSlice<T extends { id: string }, C = Partial<T>, U = Partial<T>>(
  name: string,
  apiFns: CrudApi<T, C, U>,
) {
  const adapter = createEntityAdapter<T, string>({ selectId: (e) => e.id });

  const fetchAll = createAsyncThunk<T[], void, { rejectValue: string }>(
    `${name}/fetchAll`,
    async (_arg, { rejectWithValue }) => {
      const token = getToken();
      if (!token) return rejectWithValue("not_authenticated");
      try { return await apiFns.list(token); }
      catch (e) { return rejectWithValue(String(e)); }
    },
  );

  const createOne = createAsyncThunk<T, C, { rejectValue: string }>(
    `${name}/createOne`,
    async (body, { rejectWithValue }) => {
      const token = getToken();
      if (!token) return rejectWithValue("not_authenticated");
      if (!apiFns.create) return rejectWithValue("create_not_supported");
      try { return await apiFns.create(token, body); }
      catch (e) { return rejectWithValue(String(e)); }
    },
  );

  const updateOne = createAsyncThunk<T, { id: string; body: U }, { rejectValue: string }>(
    `${name}/updateOne`,
    async ({ id, body }, { rejectWithValue }) => {
      const token = getToken();
      if (!token) return rejectWithValue("not_authenticated");
      if (!apiFns.update) return rejectWithValue("update_not_supported");
      try { return await apiFns.update(token, id, body); }
      catch (e) { return rejectWithValue(String(e)); }
    },
  );

  const deleteOne = createAsyncThunk<string, string, { rejectValue: string }>(
    `${name}/deleteOne`,
    async (id, { rejectWithValue }) => {
      const token = getToken();
      if (!token) return rejectWithValue("not_authenticated");
      if (!apiFns.remove) return rejectWithValue("remove_not_supported");
      try { await apiFns.remove(token, id); return id; }
      catch (e) { return rejectWithValue(String(e)); }
    },
  );

  const slice = createSlice({
    name,
    initialState: adapter.getInitialState<CrudExtra>({
      loading: false, loaded: false, error: null,
    }),
    reducers: {
      // Manual mutators for non-thunk flows (e.g. an SSE push or a sibling
      // endpoint that already returned the fresh row).
      upsertOne: (state, action: PayloadAction<T>) => { adapter.upsertOne(state, action.payload); },
      upsertMany: (state, action: PayloadAction<T[]>) => { adapter.upsertMany(state, action.payload); },
      removeById: (state, action: PayloadAction<string>) => { adapter.removeOne(state, action.payload); },
      setAll: (state, action: PayloadAction<T[]>) => { adapter.setAll(state, action.payload); },
      clearError(state) { state.error = null; },
    },
    extraReducers: (b) => {
      b.addCase(fetchAll.pending, (s) => { s.loading = true; s.error = null; });
      b.addCase(fetchAll.fulfilled, (s, a) => {
        s.loading = false; s.loaded = true;
        adapter.setAll(s, a.payload);
      });
      b.addCase(fetchAll.rejected, (s, a) => {
        s.loading = false; s.error = a.payload ?? a.error.message ?? "load_failed";
      });
      b.addCase(createOne.fulfilled, (s, a) => { adapter.upsertOne(s, a.payload); });
      b.addCase(updateOne.fulfilled, (s, a) => { adapter.upsertOne(s, a.payload); });
      b.addCase(deleteOne.fulfilled, (s, a) => { adapter.removeOne(s, a.payload); });
    },
  });

  return {
    name,
    reducer: slice.reducer,
    actions: slice.actions,
    adapter,
    thunks: { fetchAll, createOne, updateOne, deleteOne },
  };
}
