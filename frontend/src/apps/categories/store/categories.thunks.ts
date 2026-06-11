"use client";

import { categoriesCrud } from "./categories.slice";

export const { fetchAll, createOne, updateOne, deleteOne } = categoriesCrud.thunks;
