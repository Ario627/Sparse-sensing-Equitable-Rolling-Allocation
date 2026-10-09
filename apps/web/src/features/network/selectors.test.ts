import type {
  NetworkDetailResponse,
  PlanItemResponse,
  TelemetryLatestItemResponse,
} from "@sera/contracts";
import { describe, expect, it } from "vitest";
import {
  buildNetworkView,
  freshestFlowReading,
  sourceFlowReading,
  zoneServiceSummary,
} from "./selectors";

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
    const positionsFirst = first.flow.nodes.map((node) => [node.id, node.x, node.y]);
    const positionsSecond = second.flow.nodes.map((node) => [node.id, node.x, node.y]);
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

describe("sourceFlowReading", () => {
  function reading(
    overrides: Partial<TelemetryLatestItemResponse>,
  ): TelemetryLatestItemResponse {
    return {
      sensor_id: "s-x",
      device_id: "d-x",
      type: "FLOW",
      unit: "L/s",
      node_id: "n-src",
      node_name: "Sumber",
      block_id: null,
      value: 6.4,
      quality: "GOOD",
      ts: ISO_PAST,
      age_s: 30,
      stale: false,
      ...overrides,
    };
  }

  it("memilih bacaan debit terbaru di node sumber", () => {
    const result = sourceFlowReading(
      [
        reading({ sensor_id: "s-lama", age_s: 300 }),
        reading({ sensor_id: "s-baru", value: 7.1, age_s: 12 }),
      ],
      "n-src",
    );
    expect(result?.sensorId).toBe("s-baru");
    expect(result?.valueLps).toBe(7.1);
    expect(result?.stale).toBe(false);
    expect(result?.nodeId).toBe("n-src");
    expect(result?.nodeName).toBe("Sumber");
  });

  it("mengabaikan jenis lain, node lain, dan nilai kosong", () => {
    const result = sourceFlowReading(
      [
        reading({ type: "WATER_LEVEL" }),
        reading({ node_id: "n-mid" }),
        reading({ value: null }),
      ],
      "n-src",
    );
    expect(result).toBeNull();
  });

  it("mengembalikan null tanpa node sumber atau tanpa kandidat", () => {
    expect(sourceFlowReading([reading({})], null)).toBeNull();
    expect(sourceFlowReading([], "n-src")).toBeNull();
  });

  it("menandai bacaan basi dan memperlakukan age kosong sebagai tak terbatas", () => {
    const result = sourceFlowReading(
      [
        reading({ sensor_id: "s-tanpa-age", age_s: null }),
        reading({ sensor_id: "s-basi", stale: true, quality: "STALE" }),
      ],
      "n-src",
    );
    expect(result?.sensorId).toBe("s-basi");
    expect(result?.stale).toBe(true);
  });
});

describe("freshestFlowReading", () => {
  function flow(
    overrides: Partial<TelemetryLatestItemResponse>,
  ): TelemetryLatestItemResponse {
    return {
      sensor_id: "s-flow",
      device_id: "d-1",
      type: "FLOW",
      unit: "L/s",
      node_id: "n-mid",
      node_name: "Head Box",
      block_id: null,
      value: 5.2,
      quality: "GOOD",
      ts: ISO_PAST,
      age_s: 60,
      stale: false,
      ...overrides,
    };
  }

  it("memilih sensor debit paling segar di seluruh jaringan", () => {
    const result = freshestFlowReading([
      flow({ sensor_id: "s-a", age_s: 400 }),
      flow({ sensor_id: "s-b", age_s: 30, node_name: "Head Box" }),
      flow({ sensor_id: "s-c", type: "WATER_LEVEL" }),
    ]);
    expect(result?.sensorId).toBe("s-b");
    expect(result?.nodeName).toBe("Head Box");
  });

  it("mengembalikan null bila tidak ada sensor debit", () => {
    expect(freshestFlowReading([flow({ type: "WATER_LEVEL" })])).toBeNull();
    expect(freshestFlowReading([])).toBeNull();
  });
});

describe("zoneServiceSummary", () => {
  it("meringkas rasio per zona dari blok yang punya rencana", () => {
    const view = buildNetworkView({ detail, telemetry, planItems, now: NOW });
    const zones = zoneServiceSummary(view.blocks);
    expect(zones.map((summary) => summary.zone)).toEqual(["HEAD", "MIDDLE", "TAIL"]);
    expect(zones[0]?.blockCount).toBe(0);
    expect(zones[0]?.averageRatio).toBeNull();
    expect(zones[1]?.averageRatio).toBeCloseTo(0.72, 10);
    expect(zones[1]?.weakestBlockName).toBe("Blok Utara");
    expect(zones[2]?.averageRatio).toBeCloseTo(0.9, 10);
    expect(zones[2]?.weakestBlockName).toBe("Blok Selatan");
  });

  it("menghitung blok tanpa rasio ke jumlah blok tapi tidak ke rata-rata", () => {
    const zones = zoneServiceSummary([
      {
        blockId: "b-x",
        nodeId: "n-x",
        name: "Blok X",
        areaM2: 1000,
        nominalFlowLps: 1,
        zone: "HEAD",
        serviceRatio: null,
        band: { tone: "neutral", label: "Belum ada rencana" },
        sensors: { sensorCount: 0, staleCount: 0, worstQuality: null },
        slot: null,
      },
    ]);
    const head = zones.find((summary) => summary.zone === "HEAD");
    expect(head?.blockCount).toBe(1);
    expect(head?.sampledCount).toBe(0);
    expect(head?.averageRatio).toBeNull();
  });
});
