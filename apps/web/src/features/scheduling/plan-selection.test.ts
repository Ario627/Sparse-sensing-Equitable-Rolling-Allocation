import type { PlanItemResponse, PlanStatus, PlanSummaryResponse } from "@sera/contracts";
import { describe, expect, it } from "vitest";
import {
  isActionableStatus,
  nextUpcomingItem,
  pickActionablePlan,
  upcomingItems,
} from "./plan-selection.ts";

const CREATED = "2026-10-08T02:00:00.000Z";
const NOW = Date.parse("2026-10-08T09:00:00.000Z");

function makePlan(id: string, status: PlanStatus): PlanSummaryResponse {
  return {
    id,
    network_id: "net-1",
    network_name: "Tersier Demo",
    status,
    profile: "BALANCED",
    horizon_from: CREATED,
    horizon_to: CREATED,
    solver_name: null,
    solver_time_ms: null,
    mip_gap: null,
    item_count: 0,
    override_count: 0,
    last_approval: null,
    last_override: null,
    created_at: CREATED,
    updated_at: CREATED,
  };
}

function makeItem(id: string, slotStart: string): PlanItemResponse {
  return {
    id,
    block_id: "b-1",
    block_name: "Blok Utara",
    slot_start: slotStart,
    slot_end: slotStart,
    gate_open: true,
    volume_del_m3: null,
    volume_gross_m3: null,
    service_ratio_est: null,
    reason_json: null,
  };
}

describe("isActionableStatus", () => {
  it("menandai proposed dan fallback sebagai butuh tindakan", () => {
    expect(isActionableStatus("PROPOSED")).toBe(true);
    expect(isActionableStatus("FALLBACK")).toBe(true);
  });

  it("menandai status lain sebagai tidak butuh tindakan", () => {
    expect(isActionableStatus("APPROVED")).toBe(false);
    expect(isActionableStatus("EXECUTED")).toBe(false);
    expect(isActionableStatus("SUPERSEDED")).toBe(false);
  });
});

describe("pickActionablePlan", () => {
  it("memilih plan yang butuh tindakan meski bukan yang terbaru", () => {
    const plans = [
      makePlan("p-exec", "EXECUTED"),
      makePlan("p-prop", "PROPOSED"),
      makePlan("p-app", "APPROVED"),
    ];
    expect(pickActionablePlan(plans)?.id).toBe("p-prop");
  });

  it("memperlakukan fallback sebagai butuh tindakan", () => {
    const plans = [makePlan("p-app", "APPROVED"), makePlan("p-fb", "FALLBACK")];
    expect(pickActionablePlan(plans)?.id).toBe("p-fb");
  });

  it("jatuh ke approved bila tidak ada yang butuh tindakan", () => {
    const plans = [makePlan("p-exec", "EXECUTED"), makePlan("p-app", "APPROVED")];
    expect(pickActionablePlan(plans)?.id).toBe("p-app");
  });

  it("jatuh ke plan pertama bila semua status lain", () => {
    const plans = [makePlan("p-exec", "EXECUTED"), makePlan("p-sup", "SUPERSEDED")];
    expect(pickActionablePlan(plans)?.id).toBe("p-exec");
  });

  it("mengembalikan null untuk daftar kosong", () => {
    expect(pickActionablePlan([])).toBeNull();
  });
});

describe("nextUpcomingItem", () => {
  it("memilih slot terdekat yang belum lewat", () => {
    const items = [
      makeItem("a", "2026-10-08T10:00:00.000Z"),
      makeItem("b", "2026-10-08T09:30:00.000Z"),
      makeItem("c", "2026-10-08T08:00:00.000Z"),
    ];
    expect(nextUpcomingItem(items, NOW)?.id).toBe("b");
  });

  it("mengabaikan slot yang sudah lewat", () => {
    const items = [makeItem("a", "2026-10-08T08:00:00.000Z")];
    expect(nextUpcomingItem(items, NOW)).toBeNull();
  });

  it("menghitung slot tepat pada waktu sekarang sebagai mendatang", () => {
    const items = [makeItem("a", "2026-10-08T09:00:00.000Z")];
    expect(nextUpcomingItem(items, NOW)?.id).toBe("a");
  });

  it("mengabaikan waktu yang tidak valid", () => {
    const items = [
      makeItem("a", "bukan-tanggal"),
      makeItem("b", "2026-10-08T11:00:00.000Z"),
    ];
    expect(nextUpcomingItem(items, NOW)?.id).toBe("b");
  });

  it("mengembalikan null untuk daftar kosong", () => {
    expect(nextUpcomingItem([], NOW)).toBeNull();
  });
});

describe("upcomingItems", () => {
  it("menyaring yang lampau, mengurutkan menaik, dan membatasi jumlah", () => {
    const items = [
      makeItem("c", "2026-10-08T12:00:00.000Z"),
      makeItem("a", "2026-10-08T09:30:00.000Z"),
      makeItem("lama", "2026-10-08T08:00:00.000Z"),
      makeItem("b", "2026-10-08T10:30:00.000Z"),
    ];
    const upcoming = upcomingItems(items, NOW, 2);
    expect(upcoming.map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("mengabaikan waktu tidak valid dan batas nol", () => {
    const items = [
      makeItem("rusak", "bukan-tanggal"),
      makeItem("ok", "2026-10-08T11:00:00.000Z"),
    ];
    expect(upcomingItems(items, NOW, 0)).toEqual([]);
    expect(upcomingItems(items, NOW, 5).map((item) => item.id)).toEqual(["ok"]);
  });
});
