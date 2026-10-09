import type { PlanItemResponse } from "@sera/contracts";
import { describe, expect, it } from "vitest";
import { summarizePlanWindow } from "./plan-summary.ts";

function makeItem(overrides: Partial<PlanItemResponse>): PlanItemResponse {
  return {
    id: "p-1",
    block_id: "b-1",
    block_name: "Blok A",
    slot_start: "2026-10-09T01:00:00.000Z",
    slot_end: "2026-10-09T02:00:00.000Z",
    gate_open: true,
    volume_del_m3: null,
    volume_gross_m3: 100,
    service_ratio_est: 0.8,
    reason_json: null,
    ...overrides,
  };
}

describe("summarizePlanWindow", () => {
  it("menghitung slot, blok unik, volume, dan jendela waktu", () => {
    const summary = summarizePlanWindow([
      makeItem({ id: "p-1" }),
      makeItem({
        id: "p-2",
        block_id: "b-2",
        slot_start: "2026-10-09T02:30:00.000Z",
        slot_end: "2026-10-09T04:00:00.000Z",
        volume_gross_m3: 50,
      }),
      makeItem({ id: "p-3", block_id: "b-1", volume_gross_m3: 25 }),
    ]);
    expect(summary.slotCount).toBe(3);
    expect(summary.blockCount).toBe(2);
    expect(summary.volumeGrossM3).toBe(175);
    expect(summary.windowStart).toBe("2026-10-09T01:00:00.000Z");
    expect(summary.windowEnd).toBe("2026-10-09T04:00:00.000Z");
  });

  it("mengembalikan null volume bila semua item tanpa volume", () => {
    const summary = summarizePlanWindow([
      makeItem({ volume_gross_m3: null }),
    ]);
    expect(summary.volumeGrossM3).toBeNull();
  });

  it("mengabaikan tanggal rusak dan daftar kosong", () => {
    const summary = summarizePlanWindow([
      makeItem({
        slot_start: "bukan-tanggal",
        slot_end: "bukan-tanggal",
      }),
    ]);
    expect(summary.windowStart).toBeNull();
    expect(summary.windowEnd).toBeNull();
    expect(summarizePlanWindow([]).slotCount).toBe(0);
  });
});
