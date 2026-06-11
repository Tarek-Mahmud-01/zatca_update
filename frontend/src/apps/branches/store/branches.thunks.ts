"use client";

import { branchesCrud } from "./branches.slice";

export const { fetchAll, createOne, updateOne, deleteOne } = branchesCrud.thunks;
