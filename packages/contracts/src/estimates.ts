import { z } from "zod";
import { lossZoneSchema } from "./networks.ts";
import { sortOrderSchema } from "./query.ts";

export const estimatesLatestQuerySchema = z.strictObject({
  network_id: z.uuid().optional(),
});

export const estimatesHistoryQuerySchema = z
  .strictObject({
    network_id: z.uuid().optional(),
    block_id: z.uuid().optional(),
    from: z.iso.datetime().optional(),
    to: z.iso.datetime().optional(),
    limit: z.coerce.number().int().min(1).max(1_000).default(200),
    order: sortOrderSchema.default("desc"),
  })
  .refine(
    (value) =>
      value.from === undefined ||
      value.to === undefined ||
      Date.parse(value.from) <= Date.parse(value.to),
    { error: "from must not be later than to" },
  );

export const estimateStateItemSchema = z.strictObject({
  block_id: z.uuid(),
  block_name: z.string().min(1),
  storage_mm: z.number().nullable(),
  level_mm: z.number().nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  method: z.string().min(1).nullable(),
  ts: z.iso.datetime().nullable(),
  age_s: z.number().nonnegative().nullable(),
  stale: z.boolean(),
  state: z.unknown().nullable(),
  covariance: z.unknown().nullable(),
});

export const estimateLossItemSchema = z.strictObject({
  zone: lossZoneSchema,
  eta_mean: z.number().gt(0).max(1),
  eta_lower: z.number().gt(0).max(1),
  eta_upper: z.number().gt(0).max(1),
  identified: z.boolean(),
  valid_from: z.iso.datetime(),
  age_s: z.number().nonnegative(),
});

export const estimatesLatestResponseSchema = z.strictObject({
  items: z.array(estimateStateItemSchema),
  losses: z.array(estimateLossItemSchema),
  stale_threshold_s: z.int().positive(),
});

export const estimateHistoryItemSchema = z.strictObject({
  block_id: z.uuid(),
  ts: z.iso.datetime(),
  storage_mm: z.number().nullable(),
  confidence: z.number().min(0).max(1).nullable(),
});

export const estimatesHistoryResponseSchema = z.strictObject({
  items: z.array(estimateHistoryItemSchema),
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  limit: z.int().positive(),
});

export type EstimatesLatestQuery = z.infer<typeof estimatesLatestQuerySchema>;
export type EstimatesHistoryQuery = z.infer<typeof estimatesHistoryQuerySchema>;
export type EstimateStateItemResponse = z.infer<typeof estimateStateItemSchema>;
export type EstimateLossItemResponse = z.infer<typeof estimateLossItemSchema>;
export type EstimatesLatestResponse = z.infer<
  typeof estimatesLatestResponseSchema
>;
export type EstimateHistoryItemResponse = z.infer<
  typeof estimateHistoryItemSchema
>;
export type EstimatesHistoryResponse = z.infer<
  typeof estimatesHistoryResponseSchema
>;
