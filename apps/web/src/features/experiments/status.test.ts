import { describe, expect, it } from "vitest";
import {
  experimentStatusLabel,
  experimentStatusTone,
  progressRatio,
  runStatusLabel,
  runStatusTone,
} from "./status.ts";

describe("experimentStatusTone", () => {
  it("memetakan kelima status eksperimen", () => {
    expect(experimentStatusTone("QUEUED")).toBe("neutral");
    expect(experimentStatusTone("RUNNING")).toBe("info");
    expect(experimentStatusTone("COMPLETED")).toBe("ok");
    expect(experimentStatusTone("FAILED")).toBe("crit");
    expect(experimentStatusTone("CANCELLED")).toBe("neutral");
  });
});

describe("experimentStatusLabel", () => {
  it("memakai istilah Indonesia untuk semua status", () => {
    expect(experimentStatusLabel("QUEUED")).toBe("Dalam antrean");
    expect(experimentStatusLabel("RUNNING")).toBe("Berjalan");
    expect(experimentStatusLabel("COMPLETED")).toBe("Selesai");
    expect(experimentStatusLabel("FAILED")).toBe("Gagal");
    expect(experimentStatusLabel("CANCELLED")).toBe("Dibatalkan");
  });
});

describe("runStatusTone", () => {
  it("memetakan status run tanpa dibatalkan", () => {
    expect(runStatusTone("QUEUED")).toBe("neutral");
    expect(runStatusTone("RUNNING")).toBe("info");
    expect(runStatusTone("COMPLETED")).toBe("ok");
    expect(runStatusTone("FAILED")).toBe("crit");
  });
});

describe("runStatusLabel", () => {
  it("menulis status run dalam bahasa manusia", () => {
    expect(runStatusLabel("RUNNING")).toBe("Berjalan");
    expect(runStatusLabel("FAILED")).toBe("Gagal");
  });
});

describe("progressRatio", () => {
  it("membagi selesai terhadap total", () => {
    expect(progressRatio(820, 1000)).toBeCloseTo(0.82, 10);
    expect(progressRatio(0, 100)).toBe(0);
    expect(progressRatio(100, 100)).toBe(1);
  });

  it("mengembalikan null saat total tidak diketahui atau tidak valid", () => {
    expect(progressRatio(5, null)).toBeNull();
    expect(progressRatio(5, 0)).toBeNull();
    expect(progressRatio(5, Number.NaN)).toBeNull();
  });

  it("menjepit nilai di luar rentang", () => {
    expect(progressRatio(120, 100)).toBe(1);
    expect(progressRatio(-3, 100)).toBe(0);
    expect(progressRatio(Number.NaN, 100)).toBe(0);
  });
});
