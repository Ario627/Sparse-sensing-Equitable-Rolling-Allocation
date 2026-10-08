import {
  DEFAULT_SERVICE_RATIO,
  TARGET_STRATEGY_CAPACITY,
  TARGET_STRATEGY_WATER_BALANCE,
} from './ledger.constants.ts';

const LPS_HOUR_TO_M3 = 3.6;
const MM_PER_M = 1_000;
const HOURS_PER_DAY = 24;

export interface TargetBlockInput {
  readonly id: string;
  readonly nominalFlowLps: number;
  readonly areaM2: number;
}

export interface CropDemandInput {
  readonly blockId: string;
  readonly etcMmPerDay: number;
  readonly percMmPerDay: number | null;
}

export interface BlockTarget {
  readonly blockId: string;
  readonly targetReqM3: number;
  readonly targetFairM3: number;
  readonly strategy:
    | typeof TARGET_STRATEGY_WATER_BALANCE
    | typeof TARGET_STRATEGY_CAPACITY;
}

export function targetPhysM3(
  nominalFlowLps: number,
  periodHours: number,
): number {
  return nominalFlowLps * LPS_HOUR_TO_M3 * periodHours;
}

function targetReqFromCropM3(
  demand: CropDemandInput,
  areaM2: number,
  periodHours: number,
): number | null {
  const netMmPerDay = demand.etcMmPerDay + (demand.percMmPerDay ?? 0);
  if (!Number.isFinite(netMmPerDay) || netMmPerDay < 0) {
    return null;
  }
  const netMm = netMmPerDay * (periodHours / HOURS_PER_DAY);
  return (netMm / MM_PER_M) * areaM2;
}

export function serviceRatioOf(
  targetFairM3: number,
  deliveredM3: number,
): number {
  return targetFairM3 > 0 ? deliveredM3 / targetFairM3 : DEFAULT_SERVICE_RATIO;
}

export function resolveTargets(
  blocks: readonly TargetBlockInput[],
  demands: ReadonlyMap<string, CropDemandInput>,
  periodHours: number,
): BlockTarget[] {
  return blocks.map((block) => {
    const targetPhys = targetPhysM3(block.nominalFlowLps, periodHours);
    const demand = demands.get(block.id);
    const cropReq =
      demand === undefined
        ? null
        : targetReqFromCropM3(demand, block.areaM2, periodHours);
    if (cropReq === null) {
      return {
        blockId: block.id,
        targetReqM3: targetPhys,
        targetFairM3: targetPhys,
        strategy: TARGET_STRATEGY_CAPACITY,
      };
    }
    const targetFair = Math.min(cropReq, targetPhys);
    return {
      blockId: block.id,
      targetReqM3: cropReq,
      targetFairM3: targetFair,
      strategy: TARGET_STRATEGY_WATER_BALANCE,
    };
  });
}
