import { describe, expect, it } from "vitest";
import { buildTimelineDomain, hourTicks, percentOf } from "./timeline-scale.ts";

const HOUR_MS = 3_600_000;
const T0 = Date.parse("2026-01-01T00:00:00.000Z");

describe("percentOf", () => {
  const domain = { startMs: 1_000, endMs: 2_000, spanMs: 1_000 };

  it("memetakan tepi dan tengah domain ke 0 sampai 100", () => {
    expect(percentOf(1_000, domain)).toBe(0);
    expect(percentOf(1_500, domain)).toBe(50);
    expect(percentOf(2_000, domain)).toBe(100);
  });

  it("menjepit nilai di luar domain", () => {
    expect(percentOf(0, domain)).toBe(0);
    expect(percentOf(9_999, domain)).toBe(100);
  });

  it("menghasilkan nol untuk nilai tidak finit atau domain kosong", () => {
    expect(percentOf(Number.NaN, domain)).toBe(0);
    expect(percentOf(1_500, { startMs: 0, endMs: 0, spanMs: 0 })).toBe(0);
  });
});

describe("buildTimelineDomain", () => {
  it("selalu memuat titik waktu sekarang", () => {
    const domain = buildTimelineDomain(
      [
        [T0 + 4 * HOUR_MS, T0 + 10 * HOUR_MS],
        [T0 - 2 * HOUR_MS, T0],
      ],
      T0 + 2 * HOUR_MS,
    );
    expect(domain.startMs).toBeLessThanOrEqual(T0 + 2 * HOUR_MS);
    expect(domain.endMs).toBeGreaterThanOrEqual(T0 + 2 * HOUR_MS);
  });

  it("memberi padding proporsional di kedua ujung", () => {
    const domain = buildTimelineDomain([[T0, T0 + 10 * HOUR_MS]], T0);
    expect(domain.spanMs).toBeCloseTo(10.8 * HOUR_MS, 6);
    expect(domain.startMs).toBeCloseTo(T0 - 0.4 * HOUR_MS, 6);
    expect(domain.endMs).toBeCloseTo(T0 + 10.4 * HOUR_MS, 6);
  });

  it("menjaga lebar minimum saat tidak ada rentang nyata", () => {
    const domain = buildTimelineDomain([[T0, T0]], T0);
    expect(domain.spanMs).toBe(64_800);
    expect(domain.startMs).toBe(T0 - 32_400);
    expect(domain.endMs).toBe(T0 + 32_400);
  });

  it("mengabaikan rentang yang tidak finit", () => {
    const domain = buildTimelineDomain([[Number.NaN, Number.NaN]], T0);
    expect(domain.spanMs).toBe(64_800);
  });
});

describe("hourTicks", () => {
  it("menyelaraskan tick ke batas jam untuk rentang harian", () => {
    const domain = buildTimelineDomain([[T0, T0 + 10 * HOUR_MS]], T0);
    const ticks = hourTicks(domain);
    expect(ticks.length).toBe(11);
    expect(ticks[0]).toBe(T0);
    expect(ticks.at(-1)).toBe(T0 + 10 * HOUR_MS);
    for (let index = 1; index < ticks.length; index += 1) {
      expect((ticks[index] ?? 0) - (ticks[index - 1] ?? 0)).toBe(HOUR_MS);
    }
  });

  it("memakai langkah tiga hari untuk rentang tiga puluh hari", () => {
    const domain = buildTimelineDomain([[T0, T0 + 720 * HOUR_MS]], T0);
    const ticks = hourTicks(domain);
    expect(ticks.length).toBe(11);
    expect(ticks[0]).toBe(T0);
    expect(ticks.at(-1)).toBe(T0 + 720 * HOUR_MS);
    for (let index = 1; index < ticks.length; index += 1) {
      expect((ticks[index] ?? 0) - (ticks[index - 1] ?? 0)).toBe(72 * HOUR_MS);
    }
  });

  it("mengembalikan daftar kosong untuk rentang di luar tangga langkah", () => {
    const domain = buildTimelineDomain([[T0, T0 + 2_400 * HOUR_MS]], T0);
    expect(hourTicks(domain)).toEqual([]);
  });
});
