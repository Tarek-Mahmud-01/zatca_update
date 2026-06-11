"use client";

import { customersCrud } from "./customers.slice";

export const { fetchAll, createOne, updateOne, deleteOne } = customersCrud.thunks;
