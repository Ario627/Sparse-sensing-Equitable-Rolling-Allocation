import { describe, expect, it } from "vitest";
import {
  formatAge,
  formatAgeFrom,
  formatCappedPercent,
  formatClock,
  formatClockRange,
  formatDate,
  formatDateTime,
  formatDurationMinutes,
  formatEstimate,
  formatInterval,
  formatNumber,
  formatPercent,
  formatSigned,
  formatUnit,
} from "./format.ts";

describe("formatNumber", () => {
  it("memakai pemisah ribuan titik dan desimal koma id-ID", () => {
    expect(formatNumber(1_234_567)).toBe("1.234.567");
    expect(formatNumber(1234.5, 1)).toBe("1.234,5");
    expect(formatNumber(0)).toBe("0");
  });
});

describe("formatSigned", () => {
  it("menampilkan tanda plus hanya untuk nilai bukan nol", () => {
    expect(formatSigned(3.2, 1)).toBe("+3,2");
    expect(formatSigned(-1.8, 1)).toBe("-1,8");
    expect(formatSigned(0, 1)).toBe("0,0");
  });
});

describe("formatPercent", () => {
  it("mengonversi rasio 0..1 menjadi persen", () => {
    expect(formatPercent(0.84)).toBe("84%");
    expect(formatPercent(0.712, 1)).toBe("71,2%");
  });
});

describe("formatCappedPercent", () => {
  it("menampilkan rasio normal seperti persen biasa", () => {
    expect(formatCappedPercent(0.71)).toBe("71%");
    expect(formatCappedPercent(1)).toBe("100%");
    expect(formatCappedPercent(0.485, 1)).toBe("48,5%");
  });

  it("membatasi rasio di atas satu dengan penanda plus", () => {
    expect(formatCappedPercent(4.85)).toBe("100%+");
    expect(formatCappedPercent(3.12, 1)).toBe("100,0%+");
  });

  it("menjepit nilai negatif dan tidak finit", () => {
    expect(formatCappedPercent(-2)).toBe("0%");
    expect(formatCappedPercent(Number.NaN)).toBe("—");
    expect(formatCappedPercent(null)).toBe("—");
  });
});

describe("formatUnit", () => {
  it("menggabungkan angka dengan satuan", () => {
    expect(formatUnit(6.4, "L/s", 1)).toBe("6,4 L/s");
    expect(formatUnit(1234.56, "m³", 1)).toBe("1.234,6 m³");
  });
});

describe("formatInterval", () => {
  it("menulis rentang dengan en dash", () => {
    expect(formatInterval({ low: 0.71, high: 0.84 }, 2)).toBe("0,71–0,84");
  });
});

describe("formatEstimate", () => {
  it("menampilkan titik estimasi dengan interval opsional", () => {
    expect(formatEstimate(0.78, { low: 0.71, high: 0.84 }, 2)).toBe("0,78 [0,71–0,84]");
    expect(formatEstimate(0.78, null, 2)).toBe("0,78");
  });
});

describe("formatClock", () => {
  it("mengonversi UTC ke jam WIB dengan titik dua", () => {
    expect(formatClock("2026-10-07T02:05:00.000Z")).toBe("09:05");
  });

  it("menampilkan tengah malam sebagai 00:00", () => {
    expect(formatClock("2026-10-07T17:00:00.000Z")).toBe("00:00");
  });
});

describe("formatDate", () => {
  it("menampilkan tanggal dengan bulan singkat id-ID", () => {
    expect(formatDate("2026-10-06T22:30:00.000Z")).toBe("7 Okt 2026");
  });
});

describe("formatDateTime", () => {
  it("menggabungkan tanggal singkat dan jam", () => {
    expect(formatDateTime("2026-10-07T02:05:00.000Z")).toBe("7 Okt 09:05");
  });
});

describe("formatClockRange", () => {
  it("menulis rentang slot operasi", () => {
    expect(formatClockRange("2026-10-07T02:00:00.000Z", "2026-10-07T03:30:00.000Z")).toBe(
      "09:00–10:30",
    );
  });
});

describe("formatAge", () => {
  it("memilih satuan sesuai besaran", () => {
    expect(formatAge(45)).toBe("45 dtk");
    expect(formatAge(90)).toBe("1 mnt");
    expect(formatAge(7200)).toBe("2 j");
    expect(formatAge(172_800)).toBe("2 hr");
  });

  it("menjepit nilai negatif ke nol", () => {
    expect(formatAge(-5)).toBe("0 dtk");
  });
});

describe("formatAgeFrom", () => {
  it("menghitung umur dari timestamp dan waktu acuan", () => {
    expect(
      formatAgeFrom("2026-10-07T02:00:00.000Z", Date.parse("2026-10-07T02:15:00.000Z")),
    ).toBe("15 mnt");
  });
});

describe("formatDurationMinutes", () => {
  it("menulis durasi mode jam dan menit", () => {
    expect(formatDurationMinutes(45)).toBe("45 mnt");
    expect(formatDurationMinutes(90)).toBe("1 j 30 mnt");
    expect(formatDurationMinutes(120)).toBe("2 j");
  });
});
