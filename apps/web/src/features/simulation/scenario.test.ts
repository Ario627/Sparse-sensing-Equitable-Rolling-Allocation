import { describe, expect, it } from "vitest";
import {
  defaultScenario,
  parseSimulationSearch,
  randomSeed,
  toSimulationSearch,
} from "./scenario.ts";

describe("parseSimulationSearch", () => {
  it("mengembalikan default lengkap untuk search kosong", () => {
    expect(parseSimulationSearch({})).toEqual(defaultScenario);
  });

  it("membaca seluruh parameter yang dikenal", () => {
    const scenario = parseSimulationSearch({
      scenario: "drought",
      topology: "chain",
      sensors: "3",
      seed: "77",
      supply: "6.5",
      blocks: "12",
      horizon: "45",
    });
    expect(scenario).toEqual({
      preset: "drought",
      topology: "CHAIN",
      sensors: 3,
      seed: 77,
      supplyLps: 6.5,
      blocks: 12,
      horizonDays: 45,
    });
  });

  it("menerima preset dan topologi tanpa peduli huruf besar kecil", () => {
    const scenario = parseSimulationSearch({
      scenario: "  DROUGHT ",
      topology: "Branched",
    });
    expect(scenario.preset).toBe("drought");
    expect(scenario.topology).toBe("BRANCHED");
  });

  it("menjepit angka ke batas yang sah", () => {
    const scenario = parseSimulationSearch({
      sensors: "999",
      blocks: "1",
      horizon: "-5",
      supply: "100",
      seed: "999999999999",
    });
    expect(scenario.sensors).toBe(20);
    expect(scenario.blocks).toBe(6);
    expect(scenario.horizonDays).toBe(1);
    expect(scenario.supplyLps).toBe(20);
    expect(scenario.seed).toBe(1_000_000_000);
  });

  it("jatuh ke default untuk nilai yang tidak dikenali", () => {
    const scenario = parseSimulationSearch({
      scenario: "tidak_ada",
      topology: "grid",
      sensors: "abc",
      seed: "",
    });
    expect(scenario.preset).toBe(defaultScenario.preset);
    expect(scenario.topology).toBe(defaultScenario.topology);
    expect(scenario.sensors).toBe(defaultScenario.sensors);
    expect(scenario.seed).toBe(defaultScenario.seed);
  });
});

describe("toSimulationSearch", () => {
  it("menghilangkan nilai default dari URL", () => {
    expect(toSimulationSearch(defaultScenario)).toEqual({});
    expect(
      toSimulationSearch({ ...defaultScenario, preset: "loss_severe" }),
    ).toEqual({ scenario: "loss_severe" });
  });

  it("menulis topologi dalam huruf kecil", () => {
    const search = toSimulationSearch({
      ...defaultScenario,
      topology: "MIXED",
    });
    expect(search.topology).toBe("mixed");
  });

  it("bolak-balik menjaga skenario tetap sama", () => {
    const scenario = {
      preset: "gate_degraded" as const,
      topology: "CHAIN" as const,
      sensors: 4,
      seed: 991,
      supplyLps: 7.5,
      blocks: 8,
      horizonDays: 14,
    };
    expect(parseSimulationSearch(toSimulationSearch(scenario))).toEqual(
      scenario,
    );
    expect(parseSimulationSearch(toSimulationSearch(defaultScenario))).toEqual(
      defaultScenario,
    );
  });
});

describe("randomSeed", () => {
  it("selalu menghasilkan bilangan bulat dalam rentang seed", () => {
    for (let index = 0; index < 32; index += 1) {
      const seed = randomSeed();
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThanOrEqual(1_000_000_000);
    }
  });
});
