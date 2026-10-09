import { describe, expect, it } from 'vitest';
import { buildPlanOrderBy, buildPlanWhere } from './plans.filters.ts';
import type { PlanHistoryFilter } from './plans.types.ts';

const BASE_FILTER: PlanHistoryFilter = { sort: 'created_at', order: 'desc' };

describe('buildPlanWhere', () => {
  it('returns an empty filter when nothing is constrained', () => {
    expect(buildPlanWhere(BASE_FILTER)).toEqual({});
  });

  it('maps network, status, and profile filters', () => {
    expect(
      buildPlanWhere({
        ...BASE_FILTER,
        networkId: 'net-1',
        status: 'APPROVED',
        profile: 'BALANCED',
      }),
    ).toEqual({ networkId: 'net-1', status: 'APPROVED', profile: 'BALANCED' });
  });

  it('filters by block through the items relation', () => {
    expect(buildPlanWhere({ ...BASE_FILTER, blockId: 'blk-1' })).toEqual({
      items: { some: { blockId: 'blk-1' } },
    });
  });

  it('builds the created_at range only from provided bounds', () => {
    const from = new Date('2026-10-01T00:00:00Z');
    const to = new Date('2026-10-08T00:00:00Z');
    expect(buildPlanWhere({ ...BASE_FILTER, from })).toEqual({
      createdAt: { gte: from },
    });
    expect(buildPlanWhere({ ...BASE_FILTER, to })).toEqual({
      createdAt: { lte: to },
    });
    expect(buildPlanWhere({ ...BASE_FILTER, from, to })).toEqual({
      createdAt: { gte: from, lte: to },
    });
  });
});

describe('buildPlanOrderBy', () => {
  it('always appends a deterministic id tie-break', () => {
    expect(buildPlanOrderBy('horizon_from', 'asc')).toEqual([
      { horizonFrom: 'asc' },
      { id: 'asc' },
    ]);
    expect(buildPlanOrderBy('updated_at', 'desc')).toEqual([
      { updatedAt: 'desc' },
      { id: 'desc' },
    ]);
  });

  it('maps every supported sort field', () => {
    expect(buildPlanOrderBy('created_at', 'desc')).toEqual([
      { createdAt: 'desc' },
      { id: 'desc' },
    ]);
  });
});
