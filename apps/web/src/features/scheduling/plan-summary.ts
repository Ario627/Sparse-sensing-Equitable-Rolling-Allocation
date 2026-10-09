import type { PlanItemResponse } from "@sera/contracts";

export interface PlanWindowSummary {
  readonly slotCount: number;
  readonly blockCount: number;
  readonly volumeGrossM3: number | null;
  readonly windowStart: string | null;
  readonly windowEnd: string | null;
}

export function summarizePlanWindow(
  items: readonly PlanItemResponse[],
): PlanWindowSummary {
  const blocks = new Set<string>();
  let volumeGross = 0;
  let hasVolume = false;
  let windowStart: string | null = null;
  let windowEnd: string | null = null;
  for (const item of items) {
    blocks.add(item.block_id);
    if (item.volume_gross_m3 !== null && Number.isFinite(item.volume_gross_m3)) {
      volumeGross += item.volume_gross_m3;
      hasVolume = true;
    }
    const start = Date.parse(item.slot_start);
    if (
      Number.isFinite(start) &&
      (windowStart === null || start < Date.parse(windowStart))
    ) {
      windowStart = item.slot_start;
    }
    const end = Date.parse(item.slot_end);
    if (
      Number.isFinite(end) &&
      (windowEnd === null || end > Date.parse(windowEnd))
    ) {
      windowEnd = item.slot_end;
    }
  }
  return {
    slotCount: items.length,
    blockCount: blocks.size,
    volumeGrossM3: hasVolume ? volumeGross : null,
    windowStart,
    windowEnd,
  };
}
