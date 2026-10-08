import { describe, expect, it } from "vitest";
import {
  buildTerrainGeometry,
  type TerrainBlock,
  type TerrainFlowPoint,
} from "./terrain.ts";

const PAD_VERTEX_COUNT = 24;
const MIN_TOP_Y = 0.06;
const MAX_TOP_Y = 0.58;
const FLOW_Y = 0.02;

function makeBlock(overrides: Partial<TerrainBlock> = {}): TerrainBlock {
  return { id: "b1", x: 0, z: 0, height: 0.5, tone: "water", ...overrides };
}

function maxY(positions: Float32Array): number {
  let highest = Number.NEGATIVE_INFINITY;
  for (let index = 1; index < positions.length; index += 3) {
    highest = Math.max(highest, positions[index] ?? 0);
  }
  return highest;
}

describe("buildTerrainGeometry", () => {
  it("menghasilkan 24 vertex per pad blok", () => {
    const geometry = buildTerrainGeometry(
      [makeBlock({ id: "a" }), makeBlock({ id: "b", x: 1 })],
      [],
    );
    expect(geometry.padVertexCount).toBe(2 * PAD_VERTEX_COUNT);
    expect(geometry.padPositions.length).toBe(2 * PAD_VERTEX_COUNT * 3);
    expect(geometry.padColors.length).toBe(geometry.padPositions.length);
  });

  it("menjepit tinggi pad ke rentang minimum dan maksimum", () => {
    const flat = buildTerrainGeometry([makeBlock({ height: Number.NaN })], []);
    expect(maxY(flat.padPositions)).toBeCloseTo(MIN_TOP_Y, 6);
    const tall = buildTerrainGeometry([makeBlock({ height: 1 })], []);
    expect(maxY(tall.padPositions)).toBeCloseTo(MAX_TOP_Y, 6);
    const overflow = buildTerrainGeometry([makeBlock({ height: 3 })], []);
    expect(maxY(overflow.padPositions)).toBeCloseTo(MAX_TOP_Y, 6);
  });

  it("menjaga semua komponen warna pad dalam rentang nol sampai satu", () => {
    const geometry = buildTerrainGeometry(
      [makeBlock({ tone: "crit" }), makeBlock({ id: "c", tone: "ok" })],
      [],
    );
    for (const component of geometry.padColors) {
      expect(component).toBeGreaterThanOrEqual(0);
      expect(component).toBeLessThanOrEqual(1);
    }
  });

  it("menghasilkan busur kumulatif monotonik dari nol sampai satu", () => {
    const flow: TerrainFlowPoint[] = [
      { x: 0, z: 0 },
      { x: 1, z: 0 },
      { x: 2, z: 0 },
    ];
    const geometry = buildTerrainGeometry([], flow);
    expect(geometry.flowVertexCount).toBe(3);
    const arcs = Array.from(geometry.flowArcs);
    expect(arcs[0]).toBeCloseTo(0, 6);
    expect(arcs[1]).toBeCloseTo(0.5, 6);
    expect(arcs[2]).toBeCloseTo(1, 6);
    for (let index = 1; index < arcs.length; index += 1) {
      expect(arcs[index] ?? 0).toBeGreaterThanOrEqual(arcs[index - 1] ?? 0);
    }
  });

  it("menempatkan semua titik aliran pada ketinggian air yang sama", () => {
    const geometry = buildTerrainGeometry(
      [],
      [
        { x: 0, z: 0 },
        { x: 1, z: 1 },
      ],
    );
    expect(geometry.flowPositions[1]).toBeCloseTo(FLOW_Y, 6);
    expect(geometry.flowPositions[4]).toBeCloseTo(FLOW_Y, 6);
  });

  it("mengabaikan aliran yang kurang dari dua titik", () => {
    const geometry = buildTerrainGeometry([], [{ x: 0, z: 0 }]);
    expect(geometry.flowVertexCount).toBe(0);
    expect(geometry.flowPositions.length).toBe(0);
  });

  it("menyaring titik aliran yang tidak finit", () => {
    const geometry = buildTerrainGeometry(
      [],
      [
        { x: 0, z: 0 },
        { x: Number.NaN, z: 0 },
        { x: 2, z: 0 },
      ],
    );
    expect(geometry.flowVertexCount).toBe(2);
    expect(geometry.flowArcs[1]).toBeCloseTo(1, 6);
  });

  it("memberi busur nol saat panjang total aliran nol", () => {
    const geometry = buildTerrainGeometry(
      [],
      [
        { x: 1, z: 1 },
        { x: 1, z: 1 },
      ],
    );
    expect(Array.from(geometry.flowArcs)).toEqual([0, 0]);
  });
});
