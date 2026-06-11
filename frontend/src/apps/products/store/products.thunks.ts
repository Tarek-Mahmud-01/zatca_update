"use client";

import { productsCrud } from "./products.slice";

export const { fetchAll, createOne, updateOne, deleteOne } = productsCrud.thunks;
