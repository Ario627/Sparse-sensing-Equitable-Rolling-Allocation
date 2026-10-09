import { z } from "zod";

export const sortOrderSchema = z.enum(["asc", "desc"]);

export const pageSchema = z.coerce.number().int().min(1).default(1);

export const pageSizeSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(100)
  .default(20);

export type SortOrder = z.infer<typeof sortOrderSchema>;
