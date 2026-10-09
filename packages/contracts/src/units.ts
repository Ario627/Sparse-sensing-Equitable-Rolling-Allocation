export const LPS_HOUR_TO_M3 = 3.6;

export interface AllocationInput {
  readonly flowLps: number;
  readonly hours: number;
  readonly gateOpen: boolean;
  readonly pathEfficiency: number;
}

export interface StorageAllocationInput extends AllocationInput {
  readonly areaM2: number;
}

export function combinedPathEfficiency(
  segmentEfficiencies: readonly number[],
): number {
  if (segmentEfficiencies.length === 0) {
    throw new RangeError("path must contain at least one segment");
  }
  let product = 1;
  for (const efficiency of segmentEfficiencies) {
    assertEfficiency(efficiency);
    product *= efficiency;
  }
  return product;
}

export function deliveredVolumeM3(input: AllocationInput): number {
  assertFlow(input.flowLps);
  assertHours(input.hours);
  assertEfficiency(input.pathEfficiency);
  return input.gateOpen
    ? LPS_HOUR_TO_M3 * input.flowLps * input.hours * input.pathEfficiency
    : 0;
}

export function grossVolumeM3(input: AllocationInput): number {
  assertFlow(input.flowLps);
  assertHours(input.hours);
  assertEfficiency(input.pathEfficiency);
  return input.gateOpen
    ? (LPS_HOUR_TO_M3 * input.flowLps * input.hours) / input.pathEfficiency
    : 0;
}

export function storageDeltaMm(input: StorageAllocationInput): number {
  assertArea(input.areaM2);
  return volumeM3ToStorageMm(deliveredVolumeM3(input), input.areaM2);
}

export function volumeM3ToStorageMm(volumeM3: number, areaM2: number): number {
  assertNonNegative(volumeM3, "volumeM3");
  assertArea(areaM2);
  return (volumeM3 / areaM2) * 1000;
}

export function storageMmToVolumeM3(storageMm: number, areaM2: number): number {
  assertFinite(storageMm, "storageMm");
  assertArea(areaM2);
  return (storageMm / 1000) * areaM2;
}

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be a finite number`);
  }
}

function assertNonNegative(value: number, name: string): void {
  assertFinite(value, name);
  if (value < 0) {
    throw new RangeError(`${name} must be non-negative`);
  }
}

function assertFlow(flowLps: number): void {
  assertNonNegative(flowLps, "flowLps");
}

function assertHours(hours: number): void {
  assertNonNegative(hours, "hours");
}

function assertEfficiency(efficiency: number): void {
  assertFinite(efficiency, "pathEfficiency");
  if (!(efficiency > 0 && efficiency <= 1)) {
    throw new RangeError("pathEfficiency must be in (0, 1]");
  }
}

function assertArea(areaM2: number): void {
  assertFinite(areaM2, "areaM2");
  if (areaM2 <= 0) {
    throw new RangeError("areaM2 must be positive");
  }
}