import { z } from "zod";
import { sortOrderSchema } from "./query.ts";

export const ledgerCurrentQuerySchema = z.strictObject({
  network_id: z.uuid().optional(),
});

export const ledgerHistoryQuerySchema = z
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

export const settleLedgerRequestSchema = z.strictObject({
  network_id: z.uuid().optional(),
});

export const ledgerEntrySchema = z.strictObject({
  block_id: z.uuid(),
  block_name: z.string().min(1),
  period_start: z.iso.datetime(),
  period_end: z.iso.datetime(),
  target_req_m3: z.number().nonnegative(),
  target_fair_m3: z.number().nonnegative(),
  delivered_m3: z.number().nonnegative(),
  service_ratio: z.number().nonnegative(),
  debt_m3: z.number().nonnegative(),
  debt_capped: z.boolean(),
  created_at: z.iso.datetime(),
});

export const ledgerSummarySchema = z.strictObject({
  block_count: z.int().nonnegative(),
  worst_sr: z.number().nonnegative(),
  mean_sr: z.number().nonnegative(),
  total_debt_m3: z.number().nonnegative(),
  capped_blocks: z.int().nonnegative(),
});

export const ledgerCurrentResponseSchema = z.strictObject({
  items: z.array(ledgerEntrySchema),
  summary: ledgerSummarySchema,
  period_end: z.iso.datetime().nullable(),
  stale: z.boolean(),
  stale_threshold_s: z.int().positive(),
});

export const ledgerHistoryResponseSchema = z.strictObject({
  items: z.array(ledgerEntrySchema),
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  limit: z.int().positive(),
});

export const settleLedgerResponseSchema = z.strictObject({
  networks: z.int().nonnegative(),
  periods_settled: z.int().nonnegative(),
  rows_written: z.int().nonnegative(),
});

export type LedgerCurrentQuery = z.infer<typeof ledgerCurrentQuerySchema>;
export type LedgerHistoryQuery = z.infer<typeof ledgerHistoryQuerySchema>;
export type SettleLedgerRequest = z.infer<typeof settleLedgerRequestSchema>;
export type LedgerEntryResponse = z.infer<typeof ledgerEntrySchema>;
export type LedgerSummaryResponse = z.infer<typeof ledgerSummarySchema>;
export type LedgerCurrentResponse = z.infer<typeof ledgerCurrentResponseSchema>;
export type LedgerHistoryResponse = z.infer<typeof ledgerHistoryResponseSchema>;
export type SettleLedgerResponse = z.infer<typeof settleLedgerResponseSchema>;
