import { describe, expect, it } from "vitest";
import {
  LPS_HOUR_TO_M3,
  combinedPathEfficiency,
  deliveredVolumeM3,
  grossVolumeM3,
  storageDeltaMm,
  storageMmToVolumeM3,
  volumeM3ToStorageMm,
} from "./units.ts";

describe("LPS_HOUR_TO_M3", () => {
  it("matches the documented conversion 1 L/s × 1 h = 3.6 m3", () => {
    expect(LPS_HOUR_TO_M3).toBe(3.6);
  });
});

describe("deliveredVolumeM3", () => {
  it("converts flow, duration, and path efficiency to delivered volume", () => {
    expect(
      deliveredVolumeM3({
        flowLps: 8.7,
        hours: 1.5,
        gateOpen: true,
        pathEfficiency: 1,
      }),
    ).toBeCloseTo(46.98, 6);
  });

  it("returns zero volume while the gate is closed", () => {
    expect(
      deliveredVolumeM3({
        flowLps: 8.7,
        hours: 1.5,
        gateOpen: false,
        pathEfficiency: 1,
      }),
    ).toBe(0);
  });

  it("scales delivered volume by path efficiency", () => {
    expect(
      deliveredVolumeM3({
        flowLps: 10,
        hours: 1,
        gateOpen: true,
        pathEfficiency: 0.81,
      }),
    ).toBeCloseTo(29.16, 6);
  });
});

describe("grossVolumeM3", () => {
  it("divides by path efficiency so upstream supply covers conveyance loss", () => {
    expect(
      grossVolumeM3({
        flowLps: 8.7,
        hours: 1.5,
        gateOpen: true,
        pathEfficiency: 0.81,
      }),
    ).toBeCloseTo(58, 6);
  });

  it("is strictly above the delivered volume for efficiency below one", () => {
    const input = {
      flowLps: 12,
      hours: 2,
      gateOpen: true,
      pathEfficiency: 0.72,
    };
    expect(grossVolumeM3(input)).toBeGreaterThan(deliveredVolumeM3(input));
  });
});

describe("storage conversions", () => {
  it("converts delivered volume over block area to a millimetre change", () => {
    expect(
      storageDeltaMm({
        flowLps: 8.7,
        hours: 1.5,
        gateOpen: true,
        pathEfficiency: 1,
        areaM2: 5000,
      }),
    ).toBeCloseTo(9.396, 6);
  });

  it("round-trips volume through storage and back", () => {
    expect(
      storageMmToVolumeM3(volumeM3ToStorageMm(46.98, 5000), 5000),
    ).toBeCloseTo(46.98, 6);
  });
});

describe("combinedPathEfficiency", () => {
  it("multiplies segment efficiencies along the path", () => {
    expect(combinedPathEfficiency([0.95, 0.9, 0.95])).toBeCloseTo(0.81225, 6);
  });

  it("rejects an empty path", () => {
    expect(() => combinedPathEfficiency([])).toThrow(RangeError);
  });

  it("rejects efficiency outside (0, 1]", () => {
    expect(() => combinedPathEfficiency([1.2])).toThrow(RangeError);
    expect(() => combinedPathEfficiency([0])).toThrow(RangeError);
    expect(() => combinedPathEfficiency([Number.NaN])).toThrow(RangeError);
  });
});

describe("physical guards", () => {
  it("rejects negative and non-finite quantities", () => {
    expect(() =>
      deliveredVolumeM3({
        flowLps: -1,
        hours: 1,
        gateOpen: true,
        pathEfficiency: 1,
      }),
    ).toThrow(RangeError);
    expect(() =>
      deliveredVolumeM3({
        flowLps: Number.POSITIVE_INFINITY,
        hours: 1,
        gateOpen: true,
        pathEfficiency: 1,
      }),
    ).toThrow(RangeError);
    expect(() =>
      storageDeltaMm({
        flowLps: 1,
        hours: 1,
        gateOpen: true,
        pathEfficiency: 1,
        areaM2: 0,
      }),
    ).toThrow(RangeError);
  });
});
