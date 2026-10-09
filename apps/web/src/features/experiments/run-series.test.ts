import type { ExperimentRunResponse } from "@sera/contracts";
import { describe, expect, it } from "vitest";
import {
  buildRunSeries,
  hasMetric,
  methodLabel,
  methodsInOrder,
} from "./run-series.ts";

function makeRun(
  overrides: Partial<ExperimentRunResponse> & {
    readonly run_index: number;
    readonly method: string;
    readonly metrics?: unknown;
  },
): ExperimentRunResponse {
  return {
    scenario_id: "nominal",
    seed: 1,
    sensor_count: 2,
    topology: "CHAIN",
    k_factor: 1,
    status: "COMPLETED",
    parquet_path: null,
    metrics: {},
    started_at: null,
    finished_at: null,
    ...overrides,
  };
}

const runs: readonly ExperimentRunResponse[] = [
  makeRun({ run_index: 2, method: "sera", metrics: { decision_regret: 0.12, worst_sr: 0.7 } }),
  makeRun({ run_index: 0, method: "sera", metrics: { decision_regret: 0.2, worst_sr: 0.6 } }),
  makeRun({ run_index: 1, method: "oracle", metrics: { decision_regret: null, worst_sr: 0.9 } }),
  makeRun({ run_index: 3, method: "proportional", metrics: { decision_regret: 0.5 } }),
  makeRun({ run_index: 4, method: "custom_x", metrics: { decision_regret: 0.4 } }),
];

describe("methodLabel", () => {
  it("menerjemahkan metode yang dikenal dan meneruskan yang lain", () => {
    expect(methodLabel("sera")).toBe("SERA");
    expect(methodLabel("oracle")).toBe("Oracle (penginderaan penuh)");
    expect(methodLabel("custom_x")).toBe("custom_x");
  });
});

describe("methodsInOrder", () => {
  it("menempatkan metode kanonik lebih dulu lalu sisanya alfabetis", () => {
    expect(methodsInOrder(runs)).toEqual([
      "sera",
      "proportional",
      "oracle",
      "custom_x",
    ]);
  });
});

describe("hasMetric", () => {
  it("mendeteksi nilai non-null pada minimal satu run", () => {
    expect(hasMetric(runs, "decision_regret")).toBe(true);
    expect(hasMetric(runs, "shortage_total_m3")).toBe(false);
  });
});

describe("buildRunSeries", () => {
  it("mengelompokkan per metode dengan titik terurut menaik", () => {
    const series = buildRunSeries(runs, "decision_regret");
    expect(series.map((entry) => entry.method)).toEqual([
      "sera",
      "proportional",
      "custom_x",
    ]);
    expect(series[0]?.points).toEqual([
      { x: 0, y: 0.2 },
      { x: 2, y: 0.12 },
    ]);
  });

  it("melewati nilai null dan run tanpa metrik", () => {
    const series = buildRunSeries(runs, "decision_regret");
    expect(series.find((entry) => entry.method === "oracle")).toBeUndefined();
  });

  it("mengembalikan daftar kosong untuk metrik yang tidak ada", () => {
    expect(buildRunSeries(runs, "shortage_total_m3")).toEqual([]);
    expect(buildRunSeries([], "decision_regret")).toEqual([]);
  });
});
