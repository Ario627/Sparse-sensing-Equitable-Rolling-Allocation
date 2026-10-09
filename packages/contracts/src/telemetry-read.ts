import { z } from "zod";
import { sortOrderSchema } from "./query.ts";
import { readingQualitySchema, sensorTypeSchema } from "./telemetry.ts";

export const telemetryReadingsQuerySchema = z
  .strictObject({
    network_id: z.uuid().optional(),
    sensor_id: z.string().min(1).max(64).optional(),
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

export const telemetryReadingSchema = z.strictObject({
  id: z.string().min(1),
  sensor_id: z.string().min(1),
  block_id: z.uuid().nullable(),
  ts: z.iso.datetime(),
  value: z.number(),
  quality: readingQualitySchema,
  seq: z.int().nonnegative().nullable(),
  received_at: z.iso.datetime(),
});

export const telemetryReadingsResponseSchema = z.strictObject({
  items: z.array(telemetryReadingSchema),
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  limit: z.int().positive(),
});

export const telemetryLatestQuerySchema = z.strictObject({
  network_id: z.uuid().optional(),
});

export const telemetryLatestItemSchema = z.strictObject({
  sensor_id: z.string().min(1),
  device_id: z.string().min(1),
  type: sensorTypeSchema,
  unit: z.string().min(1),
  node_id: z.uuid().nullable(),
  node_name: z.string().nullable(),
  block_id: z.uuid().nullable(),
  value: z.number().nullable(),
  quality: readingQualitySchema.nullable(),
  ts: z.iso.datetime().nullable(),
  age_s: z.number().nonnegative().nullable(),
  stale: z.boolean(),
});

export const telemetryLatestResponseSchema = z.strictObject({
  items: z.array(telemetryLatestItemSchema),
  stale_threshold_s: z.int().positive(),
});

export type TelemetryReadingsQuery = z.infer<
  typeof telemetryReadingsQuerySchema
>;
export type TelemetryReadingResponse = z.infer<typeof telemetryReadingSchema>;
export type TelemetryReadingsResponse = z.infer<
  typeof telemetryReadingsResponseSchema
>;
export type TelemetryLatestQuery = z.infer<typeof telemetryLatestQuerySchema>;
export type TelemetryLatestItemResponse = z.infer<
  typeof telemetryLatestItemSchema
>;
export type TelemetryLatestResponse = z.infer<
  typeof telemetryLatestResponseSchema
>;
