import type { TelemetryLatestItemResponse } from "@sera/contracts";
import { describe, expect, it } from "vitest";
import {
  devicesFromLatest,
  sensorQualityLabel,
  sensorQualityTone,
  sensorTypeLabel,
  worseQuality,
} from "./status.ts";

function item(
  overrides: Partial<TelemetryLatestItemResponse> = {},
): TelemetryLatestItemResponse {
  return {
    sensor_id: "s-1",
    device_id: "d-1",
    type: "WATER_LEVEL",
    unit: "mm",
    node_id: null,
    node_name: null,
    block_id: null,
    value: 120,
    quality: "GOOD",
    ts: "2026-10-08T02:00:00.000Z",
    age_s: 30,
    stale: false,
    ...overrides,
  };
}

describe("worseQuality", () => {
  it("memilih kualitas yang lebih buruk menurut urutan GOOD sampai STALE", () => {
    expect(worseQuality("GOOD", "SUSPECT")).toBe("SUSPECT");
    expect(worseQuality("SUSPECT", "BAD")).toBe("BAD");
    expect(worseQuality("BAD", "STALE")).toBe("STALE");
    expect(worseQuality("STALE", "GOOD")).toBe("STALE");
  });

  it("memperlakukan null sebagai ketiadaan informasi", () => {
    expect(worseQuality(null, null)).toBeNull();
    expect(worseQuality(null, "SUSPECT")).toBe("SUSPECT");
    expect(worseQuality("GOOD", null)).toBe("GOOD");
  });
});

describe("sensorQualityTone", () => {
  it("memetakan kualitas bacaan dan keadaan tanpa data", () => {
    expect(sensorQualityTone("GOOD")).toBe("ok");
    expect(sensorQualityTone("SUSPECT")).toBe("warn");
    expect(sensorQualityTone("BAD")).toBe("crit");
    expect(sensorQualityTone("STALE")).toBe("crit");
    expect(sensorQualityTone(null)).toBe("neutral");
  });
});

describe("sensorQualityLabel", () => {
  it("menulis kualitas dalam bahasa manusia", () => {
    expect(sensorQualityLabel("SUSPECT")).toBe("Perlu dicek");
    expect(sensorQualityLabel(null)).toBe("Belum ada data");
  });
});

describe("sensorTypeLabel", () => {
  it("menerjemahkan kelima jenis sensor", () => {
    expect(sensorTypeLabel("WATER_LEVEL")).toBe("Muka air");
    expect(sensorTypeLabel("FLOW")).toBe("Debit");
    expect(sensorTypeLabel("PRESSURE")).toBe("Tekanan");
    expect(sensorTypeLabel("SOIL_MOISTURE")).toBe("Kelembapan tanah");
    expect(sensorTypeLabel("GATE_POSITION")).toBe("Posisi pintu");
  });
});

describe("devicesFromLatest", () => {
  it("mengembalikan daftar kosong untuk input kosong", () => {
    expect(devicesFromLatest([])).toEqual([]);
  });

  it("mengelompokkan sensor per device dan mengurutkan device", () => {
    const summaries = devicesFromLatest([
      item({ device_id: "d-2", sensor_id: "s-3" }),
      item({ device_id: "d-1", sensor_id: "s-1" }),
      item({ device_id: "d-1", sensor_id: "s-2" }),
    ]);
    expect(summaries.map((summary) => summary.deviceId)).toEqual(["d-1", "d-2"]);
    expect(summaries[0]?.sensorCount).toBe(2);
    expect(summaries[1]?.sensorCount).toBe(1);
  });

  it("menghitung sensor basi, rasio, dan kualitas terburuk", () => {
    const summaries = devicesFromLatest([
      item({ sensor_id: "s-1", stale: true }),
      item({ sensor_id: "s-2", stale: false, quality: "SUSPECT" }),
      item({ sensor_id: "s-3", stale: true, quality: "STALE" }),
      item({ sensor_id: "s-4", stale: false }),
    ]);
    const device = summaries[0];
    expect(device?.staleCount).toBe(2);
    expect(device?.staleRatio).toBeCloseTo(0.5, 10);
    expect(device?.worstQuality).toBe("STALE");
  });

  it("memakai waktu terbaru sebagai last seen", () => {
    const summaries = devicesFromLatest([
      item({ sensor_id: "s-1", ts: "2026-10-08T01:00:00.000Z" }),
      item({ sensor_id: "s-2", ts: "2026-10-08T03:00:00.000Z" }),
      item({ sensor_id: "s-3", ts: "2026-10-08T02:00:00.000Z" }),
    ]);
    expect(summaries[0]?.lastSeenIso).toBe("2026-10-08T03:00:00.000Z");
  });

  it("mengumpulkan jenis sensor dalam urutan tetap dan nama node unik", () => {
    const summaries = devicesFromLatest([
      item({ type: "FLOW", node_name: "Terminal 2" }),
      item({
        sensor_id: "s-2",
        type: "WATER_LEVEL",
        node_name: "Terminal 1",
      }),
      item({
        sensor_id: "s-3",
        type: "WATER_LEVEL",
        node_name: "Terminal 1",
      }),
    ]);
    expect(summaries[0]?.types).toEqual(["WATER_LEVEL", "FLOW"]);
    expect(summaries[0]?.nodeNames).toEqual(["Terminal 1", "Terminal 2"]);
  });

  it("deterministik untuk urutan input yang sama", () => {
    const items = [
      item({ device_id: "d-2", sensor_id: "s-2", type: "FLOW" }),
      item({ device_id: "d-1", sensor_id: "s-1" }),
    ];
    expect(devicesFromLatest(items)).toEqual(devicesFromLatest(items));
  });
});
