"use client";

import { currenciesCrud } from "./currencies.slice";

export const { fetchAll, createOne, updateOne, deleteOne } = currenciesCrud.thunks;
