import { z } from "zod";

export const commandLogStatusSchema = z.enum([
  "pending",
  "accepted",
  "rejected",
  "expired",
  "unanswered",
  "unknown",
]);

export const commandLogActionSchema = z.enum(["open", "close", "set_position"]);

export const commandLogFeedbackSchema = z.strictObject({
  position_pct: z.number().nullable(),
  flow_lps: z.number().nullable(),
  ts: z.iso.datetime(),
});

export const commandLogMismatchSchema = z.strictObject({
  expected_pct: z.int().min(0).max(100),
  deviation_pct: z.int().nonnegative(),
});

export const planCommandLogEntrySchema = z.strictObject({
  command_id: z.string().min(1).max(64),
  plan_item_id: z.uuid().nullable(),
  block_id: z.uuid().nullable(),
  block_name: z.string().min(1).nullable(),
  device_id: z.string().min(1).max(64).nullable(),
  action: commandLogActionSchema.nullable(),
  status: commandLogStatusSchema,
  issued_at: z.iso.datetime(),
  acked_at: z.iso.datetime().nullable(),
  attempts: z.int().nonnegative(),
  last_attempt_at: z.iso.datetime().nullable(),
  expires_at: z.iso.datetime().nullable(),
  target: z.string().min(1).max(64).nullable(),
  feedback: commandLogFeedbackSchema.nullable(),
  mismatch: commandLogMismatchSchema.nullable(),
});

export const planCommandLogSummarySchema = z.strictObject({
  total: z.int().nonnegative(),
  pending: z.int().nonnegative(),
  accepted: z.int().nonnegative(),
  rejected: z.int().nonnegative(),
  expired: z.int().nonnegative(),
  unanswered: z.int().nonnegative(),
  unknown: z.int().nonnegative(),
  mismatch_count: z.int().nonnegative(),
});

export const planCommandLogResponseSchema = z.strictObject({
  plan_id: z.uuid(),
  items: z.array(planCommandLogEntrySchema),
  summary: planCommandLogSummarySchema,
});

export type CommandLogStatus = z.infer<typeof commandLogStatusSchema>;
export type CommandLogAction = z.infer<typeof commandLogActionSchema>;
export type CommandLogFeedback = z.infer<typeof commandLogFeedbackSchema>;
export type CommandLogMismatch = z.infer<typeof commandLogMismatchSchema>;
export type PlanCommandLogEntry = z.infer<typeof planCommandLogEntrySchema>;
export type PlanCommandLogSummary = z.infer<typeof planCommandLogSummarySchema>;
export type PlanCommandLogResponse = z.infer<
  typeof planCommandLogResponseSchema
>;
