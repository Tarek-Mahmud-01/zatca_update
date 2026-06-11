"use client";

import { organizationsCrud } from "./organizations.slice";

export const { fetchAll, createOne, updateOne, deleteOne } = organizationsCrud.thunks;
