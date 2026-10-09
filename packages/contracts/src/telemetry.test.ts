import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  commandAckSchema,
  commandSchema,
  readingSchema,
  telemetrySchema,
} from "./telemetry.ts";

const waterLevelReading = {
  sensor_id: "lvl-head-01",
  type: "WATER_LEVEL",
  value: 412.5,
  unit: "mm",
  quality: "GOOD",
};

const flowReading = {
  sensor_id: "flow-head-01",
  type: "FLOW",
  value: 8.7,
  unit: "L/s",
  quality: "GOOD",
};

const validTelemetry = {
  schema_version: 1,
  device_id: "esp32-01",
  site_id: "demo-01",
  seq: 10231,
  ts: "2026-10-03T08:15:00Z",
  readings: [waterLevelReading, flowReading],
  battery_v: 3.92,
  rssi_dbm: -67,
  firmware: "0.3.1",
};

const commandBase = {
  schema_version: 1,
  command_id: "cmd-7f3a-001",
  ts: "2026-10-03T08:20:00Z",
  target: "gate-01",
  expires_at: "2026-10-03T08:25:00Z",
  reason: "plan:9f1c item:slot-09",
};

const validAck = {
  schema_version: 1,
  command_id: "cmd-7f3a-001",
  device_id: "esp32-01",
  ts: "2026-10-03T08:20:02Z",
  status: "accepted",
  position_pct: 60,
  detail: null,
};

function segmentPath(
  segment: PropertyKey | { readonly key: PropertyKey },
): string {
  return typeof segment === "object" && segment !== null
    ? String(segment.key)
    : String(segment);
}

function issuePaths(schema: z.ZodType, value: unknown): string[] {
  const result = schema.safeParse(value);

  if (result.success) {
    return [];
  }

  return result.error.issues.flatMap((issue) => {
    if (issue.code === "unrecognized_keys") {
      return issue.keys.map((key) =>
        [...issue.path, key].map(segmentPath).join("."),
      );
    }

    return [issue.path.map(segmentPath).join(".")];
  });
}

describe("telemetrySchema", () => {
  it("accepts the exact payload documented for v1", () => {
    expect(telemetrySchema.safeParse(validTelemetry).success).toBe(true);
  });

  it("accepts millisecond precision on the UTC timestamp", () => {
    expect(
      telemetrySchema.safeParse({
        ...validTelemetry,
        ts: "2026-10-03T08:15:00.123Z",
      }).success,
    ).toBe(true);
  });

  it("rejects timezone offsets and unqualified local time", () => {
    expect(
      telemetrySchema.safeParse({
        ...validTelemetry,
        ts: "2026-10-03T15:15:00+07:00",
      }).success,
    ).toBe(false);
    expect(
      telemetrySchema.safeParse({
        ...validTelemetry,
        ts: "2026-10-03T08:15:00",
      }).success,
    ).toBe(false);
  });

  it("rejects unknown keys and reports their path", () => {
    expect(
      issuePaths(telemetrySchema, { ...validTelemetry, firmware_hash: "abc" }),
    ).toContain("firmware_hash");
  });

  it("rejects a missing firmware field", () => {
    const withoutFirmware: Record<string, unknown> = { ...validTelemetry };
    delete withoutFirmware.firmware;
    expect(issuePaths(telemetrySchema, withoutFirmware)).toContain("firmware");
  });

  it("rejects non-integer and negative sequence numbers", () => {
    expect(
      telemetrySchema.safeParse({ ...validTelemetry, seq: 10.5 }).success,
    ).toBe(false);
    expect(
      telemetrySchema.safeParse({ ...validTelemetry, seq: -1 }).success,
    ).toBe(false);
  });

  it("rejects empty and oversized reading batches", () => {
    expect(
      telemetrySchema.safeParse({ ...validTelemetry, readings: [] }).success,
    ).toBe(false);
    const oversized = Array.from({ length: 65 }, () => waterLevelReading);
    expect(
      telemetrySchema.safeParse({ ...validTelemetry, readings: oversized })
        .success,
    ).toBe(false);
  });

  it("rejects a negative battery voltage", () => {
    expect(
      telemetrySchema.safeParse({ ...validTelemetry, battery_v: -0.1 }).success,
    ).toBe(false);
  });

  it("locates a physical-range violation inside the readings array", () => {
    const breached = {
      ...validTelemetry,
      readings: [{ ...waterLevelReading, value: 2500 }],
    };
    expect(issuePaths(telemetrySchema, breached)).toContain("readings.0");
  });
});

describe("readingSchema", () => {
  it("enforces the documented water level range in millimetres", () => {
    expect(
      readingSchema.safeParse({ ...waterLevelReading, value: 0 }).success,
    ).toBe(true);
    expect(
      readingSchema.safeParse({ ...waterLevelReading, value: 2000 }).success,
    ).toBe(true);
    expect(
      readingSchema.safeParse({ ...waterLevelReading, value: 2001 }).success,
    ).toBe(false);
    expect(
      readingSchema.safeParse({ ...waterLevelReading, unit: "cm" }).success,
    ).toBe(false);
  });

  it("enforces gate position between zero and one hundred percent", () => {
    const gateReading = {
      sensor_id: "gate-01",
      type: "GATE_POSITION",
      value: 100,
      unit: "%",
      quality: "GOOD",
    };
    expect(readingSchema.safeParse(gateReading).success).toBe(true);
    expect(
      readingSchema.safeParse({ ...gateReading, value: 101 }).success,
    ).toBe(false);
  });

  it("does not invent ranges for gauge-only sensor types", () => {
    expect(
      readingSchema.safeParse({
        sensor_id: "flow-01",
        type: "FLOW",
        value: 250,
        unit: "L/s",
        quality: "SUSPECT",
      }).success,
    ).toBe(true);
  });

  it("rejects unknown quality flags", () => {
    expect(
      readingSchema.safeParse({ ...waterLevelReading, quality: "UNKNOWN" })
        .success,
    ).toBe(false);
  });
});

describe("commandSchema", () => {
  it("accepts the documented set_position command", () => {
    expect(
      commandSchema.safeParse({
        ...commandBase,
        action: "set_position",
        position_pct: 60,
      }).success,
    ).toBe(true);
  });

  it("requires position_pct for set_position", () => {
    expect(
      commandSchema.safeParse({ ...commandBase, action: "set_position" })
        .success,
    ).toBe(false);
  });

  it("forbids position_pct on open and close", () => {
    expect(
      commandSchema.safeParse({
        ...commandBase,
        action: "open",
        position_pct: 60,
      }).success,
    ).toBe(false);
    expect(
      commandSchema.safeParse({
        ...commandBase,
        action: "close",
        position_pct: 50,
      }).success,
    ).toBe(false);
  });

  it("accepts open and close without a position", () => {
    expect(
      commandSchema.safeParse({ ...commandBase, action: "open" }).success,
    ).toBe(true);
    expect(
      commandSchema.safeParse({ ...commandBase, action: "close" }).success,
    ).toBe(true);
  });

  it("rejects unknown actions and future schema versions", () => {
    expect(
      commandSchema.safeParse({ ...commandBase, action: "toggle" }).success,
    ).toBe(false);
    expect(
      commandSchema.safeParse({
        ...commandBase,
        action: "open",
        schema_version: 2,
      }).success,
    ).toBe(false);
  });
});

describe("commandAckSchema", () => {
  it("accepts the documented accepted ack", () => {
    expect(commandAckSchema.safeParse(validAck).success).toBe(true);
  });

  it("accepts a rejected ack without a position", () => {
    const rejected = {
      ...validAck,
      status: "rejected",
      position_pct: null,
      detail: "gate stalled",
    };
    expect(commandAckSchema.safeParse(rejected).success).toBe(true);
  });

  it("requires the detail field to be present", () => {
    const withoutDetail: Record<string, unknown> = { ...validAck };
    delete withoutDetail.detail;
    expect(issuePaths(commandAckSchema, withoutDetail)).toContain("detail");
  });

  it("rejects unknown status values", () => {
    expect(
      commandAckSchema.safeParse({ ...validAck, status: "timeout" }).success,
    ).toBe(false);
  });
});
