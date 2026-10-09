import { describe, expect, it } from "vitest";
import {
  alertCodeLabel,
  alertSeverityTone,
  kFactorBand,
  planStatusLabel,
  planStatusTone,
  policyProfileLabel,
  serviceRatioBand,
} from "./status.ts";

describe("serviceRatioBand", () => {
  it("mengembalikan aman pada ambang dan di atasnya", () => {
    expect(serviceRatioBand(0.85).label).toBe("Aman");
    expect(serviceRatioBand(1).tone).toBe("ok");
  });

  it("mengembalikan cukup di pita tengah", () => {
    expect(serviceRatioBand(0.7).label).toBe("Cukup");
    expect(serviceRatioBand(0.84).label).toBe("Cukup");
  });

  it("mengembalikan kritis di bawah batas", () => {
    expect(serviceRatioBand(0.699).tone).toBe("crit");
    expect(serviceRatioBand(0).tone).toBe("crit");
  });

  it("menjepit nilai rusak ke kritis, bukan menghilang", () => {
    expect(serviceRatioBand(Number.NaN).tone).toBe("crit");
    expect(serviceRatioBand(-1).tone).toBe("crit");
    expect(serviceRatioBand(2).label).toBe("Aman");
  });
});

describe("kFactorBand", () => {
  it("mengikuti pita skenario di dokumen konteks", () => {
    expect(kFactorBand(1).label).toBe("Normal");
    expect(kFactorBand(0.9).label).toBe("Normal");
    expect(kFactorBand(0.8).label).toBe("Cukup langka");
    expect(kFactorBand(0.6).label).toBe("Kekurangan");
    expect(kFactorBand(0.4).label).toBe("Kekurangan berat");
  });

  it("membedakan tidak diketahui dari kritis", () => {
    const band = kFactorBand(null);
    expect(band.tone).toBe("neutral");
    expect(band.label).toBe("Tidak diketahui");
  });
});

describe("planStatusTone", () => {
  it("menandai semua status plan", () => {
    expect(planStatusTone("PROPOSED")).toBe("warn");
    expect(planStatusTone("APPROVED")).toBe("ok");
    expect(planStatusTone("EXECUTED")).toBe("neutral");
    expect(planStatusTone("SUPERSEDED")).toBe("neutral");
    expect(planStatusTone("FALLBACK")).toBe("fallback");
  });
});

describe("planStatusLabel", () => {
  it("memakai istilah operasi berbahasa Indonesia", () => {
    expect(planStatusLabel("PROPOSED")).toBe("Diajukan");
    expect(planStatusLabel("APPROVED")).toBe("Disetujui");
    expect(planStatusLabel("FALLBACK")).toBe("Fallback");
  });
});

describe("policyProfileLabel", () => {
  it("menerjemahkan ketiga profil kebijakan", () => {
    expect(policyProfileLabel("EQUITY_FIRST")).toBe("Pemerataan dulu");
    expect(policyProfileLabel("SHORTAGE_FIRST")).toBe("Kekurangan dulu");
    expect(policyProfileLabel("BALANCED")).toBe("Seimbang");
  });
});

describe("alertSeverityTone", () => {
  it("memetakan tiga tingkat keparahan", () => {
    expect(alertSeverityTone("info")).toBe("info");
    expect(alertSeverityTone("warning")).toBe("warn");
    expect(alertSeverityTone("critical")).toBe("crit");
  });
});

describe("alertCodeLabel", () => {
  it("menerjemahkan semua kode alert menjadi kalimat", () => {
    const codes = [
      "supply_drop",
      "sensor_offline",
      "service_floor_breach",
      "gate_mismatch",
      "fallback_active",
      "stale_data",
    ] as const;
    for (const code of codes) {
      const label = alertCodeLabel(code);
      expect(label.length).toBeGreaterThan(3);
      expect(label).not.toBe(code);
    }
  });
});
