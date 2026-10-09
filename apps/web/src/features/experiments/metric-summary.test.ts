import { describe, expect, it } from "vitest";
import type { RunMetricValue } from "./kpi.ts";
import { quantile, summarize, summarizeRuns } from "./metric-summary.ts";

function metric(key: string, value: number | null): RunMetricValue {
  return {
    descriptor: {
      key,
      label: key,
      column: key,
      unit: "",
      format: "decimal",
      direction: "higher_better",
      digits: 2,
    },
    value,
  };
}

describe("quantile", () => {
  it("cocok dengan metode linear R-7 untuk nilai yang diketahui", () => {
    const sorted = [1, 2, 3, 4];
    expect(quantile(sorted, 0.25)).toBeCloseTo(1.75, 10);
    expect(quantile(sorted, 0.5)).toBeCloseTo(2.5, 10);
    expect(quantile(sorted, 0.75)).toBeCloseTo(3.25, 10);
    expect(quantile(sorted, 0)).toBe(1);
    expect(quantile(sorted, 1)).toBe(4);
  });

  it("mengembalikan nilai tunggal apa adanya", () => {
    expect(quantile([7], 0.5)).toBe(7);
  });

  it("menolak daftar kosong dan q di luar rentang", () => {
    expect(quantile([], 0.5)).toBeNull();
    expect(quantile([1, 2], -0.1)).toBeNull();
    expect(quantile([1, 2], 1.1)).toBeNull();
    expect(quantile([1, 2], Number.NaN)).toBeNull();
  });
});

describe("summarize", () => {
  it("menghitung ringkasan lengkap untuk nilai terurut acak", () => {
    const summary = summarize([4, 1, 3, 2]);
    expect(summary).toEqual({
      n: 4,
      min: 1,
      q1: 1.75,
      median: 2.5,
      q3: 3.25,
      max: 4,
    });
  });

  it("membuang nilai tidak finit", () => {
    const summary = summarize([2, Number.NaN, 1, Number.POSITIVE_INFINITY]);
    expect(summary?.n).toBe(2);
    expect(summary?.median).toBe(1.5);
  });

  it("mengembalikan null untuk daftar kosong", () => {
    expect(summarize([])).toBeNull();
    expect(summarize([Number.NaN])).toBeNull();
  });
});

describe("summarizeRuns", () => {
  it("mengelompokkan per metode dan mengurutkan nama metode", () => {
    const summaries = summarizeRuns(
      [
        { method: "sera", values: [metric("worst_sr", 0.7)] },
        { method: "oracle", values: [metric("worst_sr", 0.9)] },
        { method: "sera", values: [metric("worst_sr", 0.8)] },
      ],
      ["worst_sr"],
    );
    expect(summaries.map((entry) => entry.method)).toEqual(["oracle", "sera"]);
    expect(summaries[1]?.runCount).toBe(2);
    expect(summaries[1]?.metrics.worst_sr?.median).toBe(0.75);
  });

  it("memisahkan jumlah run dari jumlah sampel metrik", () => {
    const summaries = summarizeRuns(
      [
        { method: "oracle", values: [metric("decision_regret", null)] },
        { method: "oracle", values: [metric("decision_regret", null)] },
      ],
      ["decision_regret"],
    );
    expect(summaries[0]?.runCount).toBe(2);
    expect(summaries[0]?.metrics.decision_regret).toBeNull();
  });

  it("mengabaikan metrik di luar kunci yang diminta", () => {
    const summaries = summarizeRuns(
      [
        {
          method: "sera",
          values: [metric("equity", 0.9), metric("worst_sr", 0.6)],
        },
      ],
      ["worst_sr"],
    );
    expect(summaries[0]?.metrics.worst_sr?.median).toBe(0.6);
    expect(summaries[0]?.metrics.equity).toBeUndefined();
  });

  it("mengembalikan daftar kosong untuk input kosong", () => {
    expect(summarizeRuns([], ["worst_sr"])).toEqual([]);
  });
});
