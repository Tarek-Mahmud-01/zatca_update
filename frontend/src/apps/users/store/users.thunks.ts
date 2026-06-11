"use client";

import { usersCrud } from "./users.slice";

// No `updateOne`: this feature has no generic CRUD update.
export const { fetchAll, createOne, deleteOne } = usersCrud.thunks;
