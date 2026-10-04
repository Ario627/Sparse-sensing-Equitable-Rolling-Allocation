import { z } from "zod";
import {
  readingSchema,
  schemaVersionSchema,
  utcTimestampSchema,
} from "./telemetry.ts";

export const policyProfileSchema = z.enum([
  "EQUITY_FIRST",
  "SHORTAGE_FIRST",
  "BALANCED",
]);

export const approvalActionSchema = z.enum([
  "APPROVE",
  "REJECT",
  "REQUEST_CHANGES",
  "OVERRIDE",
]);

export const experimentStatusSchema = z.enum([
  "QUEUED",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);

export const alertSeveritySchema = z.enum(["info", "warning", "critical"]);

export const alertCodeSchema = z.enum([
  "supply_drop",
  "sensor_offline",
  "service_floor_breach",
  "gate_mismatch",
  "fallback_active",
  "stale_data",
]);

const envelopeBaseShape = {
  schema_version: schemaVersionSchema,
  ts: utcTimestampSchema,
  network_id: z.string().min(1).max(64).nullable(),
};

export const telemetryUpdatedPayloadSchema = z.strictObject({
  device_id: z.string().min(1).max(64),
  site_id: z.string().min(1).max(64),
  seq: z.int().nonnegative(),
  readings: z.array(readingSchema).min(1).max(64),
});

export const planProposedPayloadSchema = z.strictObject({
  plan_id: z.uuid(),
  status: z.enum(["PROPOSED", "FALLBACK"]),
  profile: policyProfileSchema,
  item_count: z.int().nonnegative(),
  solver_time_ms: z.int().nonnegative().nullable(),
  mip_gap: z.number().nonnegative().nullable(),
});

export const planApprovedPayloadSchema = z.strictObject({
  plan_id: z.uuid(),
  action: approvalActionSchema,
  user_id: z.uuid(),
  decided_at: utcTimestampSchema,
  reason: z.string().min(1).max(160).nullable(),
});

export const experimentProgressPayloadSchema = z.strictObject({
  experiment_id: z.uuid(),
  status: experimentStatusSchema,
  runs_done: z.int().nonnegative(),
  runs_total: z.int().positive(),
  median_regret: z.number().nonnegative().nullable(),
  worst_sr: z.number().nonnegative().nullable(),
});

export const alertRaisedPayloadSchema = z.strictObject({
  alert_id: z.uuid(),
  severity: alertSeveritySchema,
  code: alertCodeSchema,
  message: z.string().min(1).max(300),
  block_id: z.uuid().nullable(),
  plan_id: z.uuid().nullable(),
});

export const telemetryUpdatedEventSchema = z.strictObject({
  ...envelopeBaseShape,
  type: z.literal("telemetry.updated"),
  payload: telemetryUpdatedPayloadSchema,
});

export const planProposedEventSchema = z.strictObject({
  ...envelopeBaseShape,
  type: z.literal("plan.proposed"),
  payload: planProposedPayloadSchema,
});

export const planApprovedEventSchema = z.strictObject({
  ...envelopeBaseShape,
  type: z.literal("plan.approved"),
  payload: planApprovedPayloadSchema,
});

export const planExecutedPayloadSchema = z.strictObject({
  plan_id: z.uuid(),
  status: z.literal("EXECUTED"),
  dispatched_slot_start: utcTimestampSchema,
  command_count: z.int().positive(),
});

export const planExecutedEventSchema = z.strictObject({
  ...envelopeBaseShape,
  type: z.literal("plan.executed"),
  payload: planExecutedPayloadSchema,
});

export const experimentProgressEventSchema = z.strictObject({
  ...envelopeBaseShape,
  type: z.literal("experiment.progress"),
  payload: experimentProgressPayloadSchema,
});

export const alertRaisedEventSchema = z.strictObject({
  ...envelopeBaseShape,
  type: z.literal("alert.raised"),
  payload: alertRaisedPayloadSchema,
});

export const serverEventSchema = z.discriminatedUnion("type", [
  telemetryUpdatedEventSchema,
  planProposedEventSchema,
  planApprovedEventSchema,
  planExecutedEventSchema,
  experimentProgressEventSchema,
  alertRaisedEventSchema,
]);

export type PolicyProfile = z.infer<typeof policyProfileSchema>;
export type ApprovalAction = z.infer<typeof approvalActionSchema>;
export type ExperimentStatus = z.infer<typeof experimentStatusSchema>;
export type AlertSeverity = z.infer<typeof alertSeveritySchema>;
export type AlertCode = z.infer<typeof alertCodeSchema>;
export type TelemetryUpdatedPayload = z.infer<
  typeof telemetryUpdatedPayloadSchema
>;
export type PlanProposedPayload = z.infer<typeof planProposedPayloadSchema>;
export type PlanApprovedPayload = z.infer<typeof planApprovedPayloadSchema>;
export type ExperimentProgressPayload = z.infer<
  typeof experimentProgressPayloadSchema
>;
export type AlertRaisedPayload = z.infer<typeof alertRaisedPayloadSchema>;
export type TelemetryUpdatedEvent = z.infer<typeof telemetryUpdatedEventSchema>;
export type PlanProposedEvent = z.infer<typeof planProposedEventSchema>;
export type PlanApprovedEvent = z.infer<typeof planApprovedEventSchema>;
export type ExperimentProgressEvent = z.infer<
  typeof experimentProgressEventSchema
>;
export type AlertRaisedEvent = z.infer<typeof alertRaisedEventSchema>;
export type ServerEvent = z.infer<typeof serverEventSchema>;
export type ServerEventType = ServerEvent["type"];
export type PlanExecutedPayload = z.infer<typeof planExecutedPayloadSchema>;
export type PlanExecutedEvent = z.infer<typeof planExecutedEventSchema>;