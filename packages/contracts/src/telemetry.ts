import { z } from "zod";

export const schemaVersionSchema = z.literal(1);

export const sensorTypeSchema = z.enum([
  "WATER_LEVEL",
  "FLOW",
  "PRESSURE",
  "SOIL_MOISTURE",
  "GATE_POSITION",
]);

export const readingQualitySchema = z.enum(["GOOD", "SUSPECT", "BAD", "STALE"]);

export const utcTimestampSchema = z.iso.datetime();

export type SensorType = z.infer<typeof sensorTypeSchema>;
export type ReadingQuality = z.infer<typeof readingQualitySchema>;

interface PhysicalRange {
  readonly unit: string;
  readonly min: number;
  readonly max: number;
}

const physicalRanges: Partial<Record<SensorType, PhysicalRange>> = {
  WATER_LEVEL: { unit: "mm", min: 0, max: 2000 },
  GATE_POSITION: { unit: "%", min: 0, max: 100 },
};

function withinPhysicalRange(reading: {
  readonly type: SensorType;
  readonly value: number;
  readonly unit: string;
}): boolean {
  const range = physicalRanges[reading.type];
  return (
    range === undefined ||
    (reading.unit === range.unit &&
      reading.value >= range.min &&
      reading.value <= range.max)
  );
}

export const readingSchema = z
  .strictObject({
    sensor_id: z.string().min(1).max(64),
    type: sensorTypeSchema,
    value: z.number(),
    unit: z.string().min(1).max(16),
    quality: readingQualitySchema,
  })
  .refine(withinPhysicalRange, {
    error: "reading outside the physical range of its sensor type",
  });

export const telemetrySchema = z.strictObject({
  schema_version: schemaVersionSchema,
  device_id: z.string().min(1).max(64),
  site_id: z.string().min(1).max(64),
  seq: z.int().nonnegative(),
  ts: utcTimestampSchema,
  readings: z.array(readingSchema).min(1).max(64),
  battery_v: z.number().nonnegative().optional(),
  rssi_dbm: z.int().optional(),
  firmware: z.string().min(1).max(32),
});

export const deviceStatusSchema = z.strictObject({
  schema_version: schemaVersionSchema,
  device_id: z.string().min(1).max(64),
  site_id: z.string().min(1).max(64),
  status: z.enum(["online", "offline"]),
  ts: utcTimestampSchema,
});

const commandEnvelopeShape = {
  schema_version: schemaVersionSchema,
  command_id: z.string().min(1).max(64),
  ts: utcTimestampSchema,
  target: z.string().min(1).max(64),
  expires_at: utcTimestampSchema,
  reason: z.string().min(1).max(160).optional(),
};

export const commandSchema = z.discriminatedUnion("action", [
  z.strictObject({
    ...commandEnvelopeShape,
    action: z.literal("set_position"),
    position_pct: z.int().min(0).max(100),
  }),
  z.strictObject({
    ...commandEnvelopeShape,
    action: z.literal("open"),
  }),
  z.strictObject({
    ...commandEnvelopeShape,
    action: z.literal("close"),
  }),
]);

export const commandAckSchema = z.strictObject({
  schema_version: schemaVersionSchema,
  command_id: z.string().min(1).max(64),
  device_id: z.string().min(1).max(64),
  ts: utcTimestampSchema,
  status: z.enum(["accepted", "rejected", "expired"]),
  position_pct: z.int().min(0).max(100).nullable(),
  detail: z.string().max(200).nullable(),
});

export type Reading = z.infer<typeof readingSchema>;
export type Telemetry = z.infer<typeof telemetrySchema>;
export type DeviceStatus = z.infer<typeof deviceStatusSchema>;
export type Command = z.infer<typeof commandSchema>;
export type CommandAck = z.infer<typeof commandAckSchema>;
