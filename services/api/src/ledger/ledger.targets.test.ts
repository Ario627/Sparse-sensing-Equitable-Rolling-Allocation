import { describe, expect, it } from 'vitest';
import {
  resolveTargets,
  serviceRatioOf,
  targetPhysM3,
  type TargetBlockInput,
} from './ledger.targets.ts';

const BLOCKS: TargetBlockInput[] = [
  { id: 'blk-a', nominalFlowLps: 2.5, areaM2: 4_000 },
  { id: 'blk-b', nominalFlowLps: 3, areaM2: 5_000 },
];

describe('targetPhysM3', () => {
  it('converts lps and hours into cubic meters', () => {
    expect(targetPhysM3(2.5, 6)).toBeCloseTo(54, 10);
  });

  it('returns zero for idle blocks', () => {
    expect(targetPhysM3(0, 6)).toBe(0);
  });
});

describe('serviceRatioOf', () => {
  it('returns the default ratio when the target is zero', () => {
    expect(serviceRatioOf(0, 12)).toBe(1);
  });

  it('divides delivered volume by the fair target', () => {
    expect(serviceRatioOf(50, 25)).toBeCloseTo(0.5, 10);
  });
});

describe('resolveTargets', () => {
  it('falls back to physical capacity without crop demand', () => {
    const targets = resolveTargets(BLOCKS, new Map(), 6);
    expect(targets).toHaveLength(2);
    expect(targets[0]?.strategy).toBe('capacity');
    expect(targets[0]?.targetReqM3).toBeCloseTo(54, 10);
    expect(targets[0]?.targetFairM3).toBeCloseTo(54, 10);
  });

  it('uses the water balance when crop demand exists', () => {
    const demands = new Map([
      ['blk-a', { blockId: 'blk-a', etcMmPerDay: 8, percMmPerDay: 2 }],
    ]);
    const targets = resolveTargets(BLOCKS, demands, 6);
    expect(targets[0]?.strategy).toBe('water_balance');
    expect(targets[0]?.targetReqM3).toBeCloseTo(10, 10);
    expect(targets[1]?.strategy).toBe('capacity');
  });

  it('caps the fair target at physical capacity', () => {
    const demands = new Map([
      ['blk-a', { blockId: 'blk-a', etcMmPerDay: 60, percMmPerDay: 4 }],
    ]);
    const targets = resolveTargets(BLOCKS, demands, 6);
    expect(targets[0]?.targetReqM3).toBeCloseTo(64, 10);
    expect(targets[0]?.targetFairM3).toBeCloseTo(54, 10);
  });

  it('treats missing percolation as zero', () => {
    const demands = new Map([
      ['blk-b', { blockId: 'blk-b', etcMmPerDay: 6, percMmPerDay: null }],
    ]);
    const targets = resolveTargets(BLOCKS, demands, 6);
    expect(targets[1]?.strategy).toBe('water_balance');
    expect(targets[1]?.targetReqM3).toBeCloseTo(7.5, 10);
  });

  it('ignores demand that is negative or non-finite', () => {
    const demands = new Map([
      ['blk-a', { blockId: 'blk-a', etcMmPerDay: -3, percMmPerDay: 1 }],
    ]);
    const targets = resolveTargets(BLOCKS, demands, 6);
    expect(targets[0]?.strategy).toBe('capacity');
    expect(targets[0]?.targetReqM3).toBeCloseTo(54, 10);
  });
});
