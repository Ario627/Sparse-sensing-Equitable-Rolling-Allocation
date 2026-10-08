import type {
  NetworkDetailResponse,
  PlanItemResponse,
  TelemetryLatestItemResponse,
} from "@sera/contracts";
import { describe, expect, it } from "vitest";
import { buildNetworkView } from "./selectors";

const NOW = Date.parse("2026-10-08T09:00:00.000Z");
const ISO_PAST = "2026-10-08T08:00:00.000Z";
const ISO_SOON = "2026-10-08T09:30:00.000Z";

const detail: NetworkDetailResponse = {
  id: "net-1",
  name: "Tersier Demo",
  description: null,
  topology: "CHAIN",
  p3a_id: null,
  node_count: 5,
  edge_count: 3,
  block_count: 2,
  created_at: ISO_PAST,
  updated_at: ISO_PAST,
  nodes: [
    {
      id: "n-src",
      type: "SOURCE",
      name: "Sumber",
      order_idx: null,
      metadata: null,
    },
    {
      id: "n-mid",
      type: "JUNCTION",
      name: "Pertemuan",
      order_idx: null,
      metadata: null,
    },
    {
      id: "n-t1",
      type: "BLOCK_TERMINAL",
      name: "Terminal 1",
      order_idx: 0,
      metadata: null,
    },
    {
      id: "n-t2",
      type: "BLOCK_TERMINAL",
      name: "Terminal 2",
      order_idx: 1,
      metadata: null,
    },
    {
      id: "n-orphan",
      type: "JUNCTION",
      name: "Terputus",
      order_idx: null,
      metadata: null,
    },
  ],
  edges: [
    {
      id: "e-1",
      from_node_id: "n-src",
      to_node_id: "n-mid",
      length_m: null,
      capacity_lps: 10,
      zone: "HEAD",
    },
    {
      id: "e-2",
      from_node_id: "n-mid",
      to_node_id: "n-t1",
      length_m: 80,
      capacity_lps: 8,
      zone: "MIDDLE",
    },
    {
      id: "e-3",
      from_node_id: "n-mid",
      to_node_id: "n-t2",
      length_m: 120,
      capacity_lps: 8,
      zone: "TAIL",
    },
  ],
  blocks: [
    {
      id: "b-1",
      node_id: "n-t1",
      name: "Blok Utara",
      area_m2: 5000,
      crop_type: "paddy",
      nominal_flow_lps: 4,
      distance_from_source_m: 120,
      soil_type: null,
      metadata: null,
    },
    {
      id: "b-2",
      node_id: "n-t2",
      name: "Blok Selatan",
      area_m2: 3000,
      crop_type: "paddy",
      nominal_flow_lps: 2,
      distance_from_source_m: 210,
      soil_type: null,
      metadata: null,
    },
  ],
};

const telemetry: TelemetryLatestItemResponse[] = [
  {
    sensor_id: "s-1",
    device_id: "d-1",
    type: "WATER_LEVEL",
    unit: "mm",
    node_id: "n-t1",
    node_name: "Terminal 1",
    block_id: "b-1",
    value: 180,
    quality: "GOOD",
    ts: ISO_PAST,
    age_s: 20,
    stale: false,
  },
  {
    sensor_id: "s-2",
    device_id: "d-2",
    type: "FLOW",
    unit: "L/s",
    node_id: "n-t1",
    node_name: "Terminal 1",
    block_id: "b-1",
    value: 3.9,
    quality: "STALE",
    ts: ISO_PAST,
    age_s: 900,
    stale: true,
  },
  {
    sensor_id: "s-3",
    device_id: "d-3",
    type: "SOIL_MOISTURE",
    unit: "%",
    node_id: "n-t2",
    node_name: "Terminal 2",
    block_id: "b-2",
    value: 31,
    quality: "SUSPECT",
    ts: ISO_PAST,
    age_s: 60,
    stale: false,
  },
  {
    sensor_id: "s-4",
    device_id: "d-4",
    type: "GATE_POSITION",
    unit: "%",
    node_id: "n-mid",
    node_name: "Pertemuan",
    block_id: null,
    value: 60,
    quality: "BAD",
    ts: ISO_PAST,
    age_s: 120,
    stale: false,
  },
];

function planItem(overrides: Partial<PlanItemResponse>): PlanItemResponse {
  return {
    id: "p-x",
    block_id: "b-1",
    block_name: "Blok Utara",
    slot_start: ISO_SOON,
    slot_end: "2026-10-08T10:30:00.000Z",
    gate_open: true,
    volume_del_m3: 120,
    volume_gross_m3: 150,
    service_ratio_est: 0.72,
    reason_json: null,
    ...overrides,
  };
}

const planItems: PlanItemResponse[] = [
  planItem({
    id: "p-old",
    slot_start: ISO_PAST,
    slot_end: ISO_PAST,
    service_ratio_est: 0.4,
  }),
  planItem({
    id: "p-soon",
    slot_start: ISO_SOON,
    slot_end: "2026-10-08T10:30:00.000Z",
    service_ratio_est: 0.72,
  }),
  planItem({
    id: "p-b2",
    block_id: "b-2",
    block_name: "Blok Selatan",
    slot_start: "2026-10-08T07:00:00.000Z",
    slot_end: "2026-10-08T08:00:00.000Z",
    gate_open: false,
    service_ratio_est: 0.9,
  }),
];

describe("buildNetworkView", () => {
  it("memilih slot terdekat yang belum lewat dan menandainya upcoming", () => {
    const view = buildNetworkView({ detail, telemetry, planItems, now: NOW });
    const utara = view.blocks.find((block) => block.blockId === "b-1");
    expect(utara?.serviceRatio).toBeCloseTo(0.72, 6);
    expect(utara?.slot?.upcoming).toBe(true);
    expect(utara?.slot?.slotStart).toBe(ISO_SOON);
  });

  it("memakai slot terbaru yang sudah lewat bila tidak ada slot mendatang", () => {
    const view = buildNetworkView({ detail, telemetry, planItems, now: NOW });
    const selatan = view.blocks.find((block) => block.blockId === "b-2");
    expect(selatan?.serviceRatio).toBeCloseTo(0.9, 6);
    expect(selatan?.slot?.upcoming).toBe(false);
    expect(selatan?.slot?.gateOpen).toBe(false);
  });

  it("menandai blok tanpa rencana sebagai belum ada rencana, bukan kritis", () => {
    const view = buildNetworkView({ detail, telemetry, now: NOW });
    for (const block of view.blocks) {
      expect(block.serviceRatio).toBeNull();
      expect(block.band.tone).toBe("neutral");
      expect(block.band.label).toBe("Belum ada rencana");
    }
  });

  it("mengagregasi sensor per blok dan melewati sensor tanpa blok", () => {
    const view = buildNetworkView({ detail, telemetry, planItems, now: NOW });
    const utara = view.blocks.find((block) => block.blockId === "b-1");
    expect(utara?.sensors.sensorCount).toBe(2);
    expect(utara?.sensors.staleCount).toBe(1);
    expect(utara?.sensors.worstQuality).toBe("STALE");
    const selatan = view.blocks.find((block) => block.blockId === "b-2");
    expect(selatan?.sensors.sensorCount).toBe(1);
    expect(selatan?.sensors.worstQuality).toBe("SUSPECT");
  });

  it("mengambil zona blok dari edge yang menuju node-nya", () => {
    const view = buildNetworkView({ detail, telemetry, planItems, now: NOW });
    const utara = view.blocks.find((block) => block.blockId === "b-1");
    const selatan = view.blocks.find((block) => block.blockId === "b-2");
    expect(utara?.zone).toBe("MIDDLE");
    expect(selatan?.zone).toBe("TAIL");
  });

  it("meringkas kondisi jaringan termasuk sensor terjepit di node", () => {
    const view = buildNetworkView({ detail, telemetry, planItems, now: NOW });
    expect(view.summary.blockCount).toBe(2);
    expect(view.summary.sensorCount).toBe(4);
    expect(view.summary.staleSensorCount).toBe(1);
    expect(view.summary.worstSensorQuality).toBe("STALE");
    expect(view.summary.averageServiceRatio).toBeCloseTo(0.81, 6);
    expect(view.summary.weakestBlockName).toBe("Blok Utara");
    expect(view.summary.weakestServiceRatio).toBeCloseTo(0.72, 6);
  });

  it("membangun flow dengan posisi deterministik untuk semua node", () => {
    const first = buildNetworkView({ detail, telemetry, planItems, now: NOW });
    const second = buildNetworkView({ detail, telemetry, planItems, now: NOW });
    expect(first.flow.nodes.length).toBe(5);
    expect(first.flow.edges.length).toBe(3);
    const positionsFirst = first.flow.nodes.map((node) => [
      node.id,
      node.x,
      node.y,
    ]);
    const positionsSecond = second.flow.nodes.map((node) => [
      node.id,
      node.x,
      node.y,
    ]);
    expect(positionsFirst).toEqual(positionsSecond);
    for (const node of first.flow.nodes) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
    }
  });

  it("memberi jenis node blok hanya bila blok benar-benar ada", () => {
    const view = buildNetworkView({ detail, telemetry, planItems, now: NOW });
    const terminal = view.flow.nodes.find((node) => node.id === "n-t1");
    expect(terminal?.kind).toBe("block");
    expect(terminal?.data.block?.name).toBe("Blok Utara");
    expect(terminal?.data.role).toBe("Blok · Tengah");
    const source = view.flow.nodes.find((node) => node.id === "n-src");
    expect(source?.kind).toBe("source");
    expect(source?.data.role).toBe("Sumber");
  });

  it("menempatkan node terputus di baris setelah kedalaman maksimum", () => {
    const view = buildNetworkView({ detail, telemetry, planItems, now: NOW });
    const orphan = view.flow.nodes.find((node) => node.id === "n-orphan");
    const junction = view.flow.nodes.find((node) => node.id === "n-mid");
    expect(orphan?.y ?? 0).toBeGreaterThan(junction?.y ?? 0);
  });
});
