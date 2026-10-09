import { describe, expect, it } from 'vitest';
import type { SolverPlanItem } from '../solver/solver.client.ts';
import {
  buildFallbackResult,
  shiftFallbackPlan,
  validatePlanItems,
} from './plans.solver-payload.ts';
import type { FallbackPlanData } from './plans.types.ts';

const NOW = new Date('2026-10-08T03:00:00Z');

function planItem(blockId: string, startIso: string): SolverPlanItem {
  return {
    block_id: blockId,
    slot_start: startIso,
    slot_end: new Date(Date.parse(startIso) + 3_600_000).toISOString(),
    gate_open: true,
  };
}

function fallbackData(): FallbackPlanData {
  return {
    sourcePlanId: 'plan-1',
    items: [
      {
        blockId: 'blk-a',
        slotStart: new Date('2026-10-08T00:00:00Z'),
        slotEnd: new Date('2026-10-08T01:00:00Z'),
        gateOpen: true,
        volumeDelM3: 9,
        volumeGrossM3: 11,
        serviceRatioEst: 0.8,
        reasonJson: null,
      },
      {
        blockId: 'blk-a',
        slotStart: new Date('2026-10-08T08:00:00Z'),
        slotEnd: new Date('2026-10-08T09:00:00Z'),
        gateOpen: false,
        volumeDelM3: 0,
        volumeGrossM3: 0,
        serviceRatioEst: 0,
        reasonJson: null,
      },
    ],
  };
}

describe('validatePlanItems', () => {
  it('accepts items that reference known blocks', () => {
    const issues = validatePlanItems(
      [planItem('blk-a', '2026-10-08T00:00:00Z')],
      new Set(['blk-a']),
    );
    expect(issues).toEqual([]);
  });

  it('flags blocks outside the network', () => {
    const issues = validatePlanItems(
      [planItem('ghost', '2026-10-08T00:00:00Z')],
      new Set(['blk-a']),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('unknown block');
  });

  it('flags duplicated block-slot pairs', () => {
    const issues = validatePlanItems(
      [
        planItem('blk-a', '2026-10-08T00:00:00Z'),
        planItem('blk-a', '2026-10-08T00:00:00Z'),
      ],
      new Set(['blk-a']),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('duplicate');
  });
});

describe('shiftFallbackPlan', () => {
  it('shifts the schedule so the first slot starts now', () => {
    const shifted = shiftFallbackPlan(fallbackData(), NOW);
    expect(shifted).not.toBeNull();
    expect(shifted?.items).toHaveLength(1);
    expect(shifted?.items[0]?.slotStart.toISOString()).toBe(
      '2026-10-08T03:00:00.000Z',
    );
    expect(shifted?.items[0]?.slotEnd.toISOString()).toBe(
      '2026-10-08T04:00:00.000Z',
    );
  });

  it('drops slots that fall outside the fallback window', () => {
    const shifted = shiftFallbackPlan(fallbackData(), NOW);
    expect(shifted?.items.some((item) => item.gateOpen === false)).toBe(false);
  });

  it('returns null when there is nothing to replay', () => {
    expect(
      shiftFallbackPlan({ sourcePlanId: 'plan-1', items: [] }, NOW),
    ).toBeNull();
  });
});

describe('buildFallbackResult', () => {
  it('marks the result as a replay of the source plan', () => {
    const result = buildFallbackResult(fallbackData(), 'solver down');
    expect(result.request_id).toBe('fallback-plan-1');
    expect(result.plan_id).toBeNull();
    expect(result.solver_stats.solver).toBe('fallback-last-feasible');
    expect(result.solver_stats.time_ms).toBe(0);
    expect(result.scenarios).toEqual([]);
  });

  it('maps stored items back into solver wire items', () => {
    const result = buildFallbackResult(fallbackData(), 'solver down');
    expect(result.items[0]?.block_id).toBe('blk-a');
    expect(result.items[0]?.slot_start).toBe('2026-10-08T00:00:00.000Z');
    expect(result.items[0]?.volume_del_m3).toBe(9);
  });

  it('records the fallback reason in the objective', () => {
    const result = buildFallbackResult(fallbackData(), 'solver down');
    expect(result.objective).toEqual({
      fallback: { reason: 'solver down', source_plan_id: 'plan-1' },
    });
  });
});
