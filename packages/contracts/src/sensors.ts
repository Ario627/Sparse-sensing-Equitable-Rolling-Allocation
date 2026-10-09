import { z } from "zod";
import { pageSchema, pageSizeSchema } from "./query.ts";
import { sensorTypeSchema, type SensorType } from "./telemetry.ts";

export const sensorIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/);

export const sensorDeviceIdSchema = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/);

export const calibrationMethodSchema = z.enum(["power_law", "linear"]);

const calibrationFitSchema = z.strictObject({
  r2: z.number().min(0).max(1).nullable().default(null),
  rmse: z.number().nonnegative().nullable().default(null),
  points: z.int().nonnegative().nullable().default(null),
});

export const sensorCalibrationSchema = z
  .strictObject({
    method: calibrationMethodSchema,
    params: z.record(z.string(), z.number()),
    fit: calibrationFitSchema.default({ r2: null, rmse: null, points: null }),
    calibrated_at: z.iso.datetime().nullable().default(null),
    operator: z.string().trim().max(80).nullable().default(null),
    notes: z.string().trim().max(280).nullable().default(null),
  })
  .refine(
    (value) =>
      value.method !== "power_law" ||
      ((value.params.C ?? 0) > 0 && (value.params.n ?? 0) > 0),
    { error: "power_law calibration requires positive params.C and params.n" },
  )
  .refine(
    (value) =>
      value.method !== "linear" ||
      (value.params.a !== undefined && value.params.b !== undefined),
    { error: "linear calibration requires params.a and params.b" },
  );

const CANONICAL_UNITS: Partial<Record<SensorType, string>> = {
  WATER_LEVEL: "mm",
  GATE_POSITION: "%",
};

function followsCanonicalUnit(type: SensorType, unit: string): boolean {
  const canonical = CANONICAL_UNITS[type];
  return canonical === undefined || canonical === unit;
}

export const createSensorRequestSchema = z
  .strictObject({
    id: sensorIdSchema.optional(),
    network_id: z.uuid(),
    node_id: z.uuid().nullable().optional(),
    device_id: sensorDeviceIdSchema,
    type: sensorTypeSchema,
    unit: z.string().trim().min(1).max(16),
    installed_at: z.iso.datetime().nullable().optional(),
    calibration: sensorCalibrationSchema.nullable().optional(),
  })
  .refine((value) => followsCanonicalUnit(value.type, value.unit), {
    error: "unit does not follow the canonical unit for the sensor type",
  });

export const updateSensorRequestSchema = z
  .strictObject({
    node_id: z.uuid().nullable().optional(),
    device_id: sensorDeviceIdSchema.optional(),
    is_active: z.boolean().optional(),
    calibration: sensorCalibrationSchema.nullable().optional(),
  })
  .refine(
    (value) => Object.values(value).some((field) => field !== undefined),
    { error: "at least one field must be provided" },
  );

export const listSensorsQuerySchema = z.strictObject({
  network_id: z.uuid().optional(),
  node_id: z.uuid().optional(),
  device_id: sensorDeviceIdSchema.optional(),
  type: sensorTypeSchema.optional(),
  is_active: z.stringbool().optional(),
  q: z
    .string()
    .trim()
    .max(64)
    .optional()
    .transform((value) =>
      value === undefined || value.length === 0 ? undefined : value,
    ),
  page: pageSchema,
  limit: pageSizeSchema,
});

export const sensorDevicesQuerySchema = z.strictObject({
  network_id: z.uuid().optional(),
});

export const sensorSummarySchema = z.strictObject({
  id: z.string().min(1),
  device_id: z.string().min(1),
  network_id: z.uuid(),
  type: sensorTypeSchema,
  unit: z.string().min(1),
  is_active: z.boolean(),
  node_id: z.uuid().nullable(),
  node_name: z.string().nullable(),
  block_id: z.uuid().nullable(),
  block_name: z.string().nullable(),
  installed_at: z.iso.datetime().nullable(),
  calibrated: z.boolean(),
  calibration_method: z.string().nullable(),
  calibrated_at: z.iso.datetime().nullable(),
  last_reading_at: z.iso.datetime().nullable(),
  age_s: z.number().nonnegative().nullable(),
  stale: z.boolean(),
});

export const sensorDetailSchema = sensorSummarySchema.extend({
  calibration: z.unknown().nullable(),
});

export const sensorDeviceSummarySchema = z.strictObject({
  device_id: z.string().min(1),
  network_ids: z.array(z.uuid()),
  sensor_count: z.int().nonnegative(),
  active_sensor_count: z.int().nonnegative(),
  last_seen_at: z.iso.datetime().nullable(),
  age_s: z.number().nonnegative().nullable(),
  stale: z.boolean(),
});

export const sensorsListResponseSchema = z.strictObject({
  items: z.array(sensorSummarySchema),
  page: z.int().positive(),
  limit: z.int().positive(),
  total: z.int().nonnegative(),
  total_pages: z.int().positive(),
});

export const sensorDevicesResponseSchema = z.strictObject({
  items: z.array(sensorDeviceSummarySchema),
  stale_threshold_s: z.int().positive(),
});

export type SensorCalibration = z.infer<typeof sensorCalibrationSchema>;
export type ListSensorsQuery = z.infer<typeof listSensorsQuerySchema>;
export type SensorDevicesQuery = z.infer<typeof sensorDevicesQuerySchema>;
export type CreateSensorRequest = z.infer<typeof createSensorRequestSchema>;
export type UpdateSensorRequest = z.infer<typeof updateSensorRequestSchema>;
export type SensorSummaryResponse = z.infer<typeof sensorSummarySchema>;
export type SensorDetailResponse = z.infer<typeof sensorDetailSchema>;
export type SensorDeviceSummaryResponse = z.infer<
  typeof sensorDeviceSummarySchema
>;
export type SensorsListResponse = z.infer<typeof sensorsListResponseSchema>;
export type SensorDevicesResponse = z.infer<typeof sensorDevicesResponseSchema>;
