import { describe, expect, it } from "vitest";
import { toYaml } from "@/lib/yaml.ts";
import { defaultScenario } from "./scenario.ts";
import {
  buildExperimentConfig,
  buildExperimentYaml,
  defaultSensorSet,
  generateExperimentId,
} from "./run.ts";

describe("defaultSensorSet", () => {
  it("memetakan jumlah sensor ke id blok b1 sampai bN", () => {
    expect(defaultSensorSet(2, 10)).toEqual(["b1", "b2"]);
    expect(defaultSensorSet(0, 10)).toEqual([]);
    expect(defaultSensorSet(3, 10)).toEqual(["b1", "b2", "b3"]);
  });

  it("menjepit jumlah ke rentang blok yang ada", () => {
    expect(defaultSensorSet(15, 6)).toHaveLength(6);
    expect(defaultSensorSet(-2, 6)).toEqual([]);
    expect(defaultSensorSet(2.6, 6)).toHaveLength(3);
  });
});

describe("generateExperimentId", () => {
  it("stabil untuk input yang sama dan berupa alfanumerik huruf kecil", () => {
    const id = generateExperimentId(1042, 1_760_000_000_000);
    expect(id).toBe(generateExperimentId(1042, 1_760_000_000_000));
    expect(id).toMatch(/^[a-z][a-z0-9]*$/);
  });

  it("berbeda saat waktu berbeda", () => {
    expect(generateExperimentId(1, 1_000)).not.toBe(
      generateExperimentId(1, 2_000),
    );
  });
});

describe("buildExperimentConfig", () => {
  it("memuat seluruh kunci grid yang diwajibkan loader solver", () => {
    const config = buildExperimentConfig({
      experimentId: "expdemo",
      scenario: defaultScenario,
    });
    for (const key of [
      "experiment_id",
      "methods",
      "scenarios",
      "block_counts",
      "topologies",
      "k_factors",
      "sensor_sets",
      "replicates",
    ]) {
      expect(Object.hasOwn(config, key)).toBe(true);
    }
  });

  it("memakai default sera, satu replikat, dan faktor k satu", () => {
    const config = buildExperimentConfig({
      experimentId: "expdemo",
      scenario: defaultScenario,
    });
    expect(config.methods).toEqual(["sera"]);
    expect(config.replicates).toBe(1);
    expect(config.k_factors).toEqual([1]);
    expect(config.scenarios).toEqual(["nominal"]);
  });

  it("meneruskan override metode dan replikat", () => {
    const config = buildExperimentConfig({
      experimentId: "expdemo",
      scenario: defaultScenario,
      methods: ["sera", "proportional", "oracle"],
      replicates: 5,
    });
    expect(config.methods).toEqual(["sera", "proportional", "oracle"]);
    expect(config.replicates).toBe(5);
  });
});

describe("buildExperimentYaml", () => {
  it("menulis yaml deterministik dengan set sensor bersarang", () => {
    const scenario = {
      ...defaultScenario,
      preset: "drought" as const,
      sensors: 2,
      blocks: 10,
      topology: "BRANCHED" as const,
    };
    const first = buildExperimentYaml({ experimentId: "expdemo", scenario });
    const second = buildExperimentYaml({ experimentId: "expdemo", scenario });
    expect(first).toBe(second);
    expect(first).toContain("experiment_id: 'expdemo'");
    expect(first).toContain("- 'drought'");
    expect(first).toContain("- 'BRANCHED'");
    expect(first).toContain("  - 10");
    expect(first).toContain("- - 'b1'");
    expect(first).toContain("    - 'b2'");
    expect(first).toContain("replicates: 1");
  });

  it("menulis set sensor kosong sebagai daftar kosong di dalam daftar", () => {
    const yaml = buildExperimentYaml({
      experimentId: "expdemo",
      scenario: { ...defaultScenario, sensors: 0 },
    });
    expect(yaml).toContain("sensor_sets:\n  - []");
  });
});

describe("toYaml", () => {
  it("mengutip string dan menggandakan apostrof", () => {
    expect(toYaml({ name: "it's" })).toBe("name: 'it''s'\n");
  });

  it("menulis skalar, daftar, dan objek bersarang", () => {
    expect(
      toYaml({ a: 1, b: true, c: ["x", 2], d: { e: "y" } }),
    ).toBe("a: 1\nb: true\nc:\n  - 'x'\n  - 2\nd:\n  e: 'y'\n");
  });

  it("menulis daftar dan objek kosong secara inline", () => {
    expect(toYaml({ a: [], b: {} })).toBe("a: []\nb: {}\n");
  });

  it("menolak angka tidak finit dan kunci yang bukan identifier", () => {
    expect(() => toYaml({ a: Number.NaN })).toThrow(RangeError);
    expect(() => toYaml({ a: Number.POSITIVE_INFINITY })).toThrow(RangeError);
    expect(() => toYaml({ "a b": 1 })).toThrow(RangeError);
  });
});