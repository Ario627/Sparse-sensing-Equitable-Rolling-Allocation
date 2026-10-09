import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { LossZone, SortOrder } from '@sera/contracts';
import type { Env } from '../common/config/env.ts';
import type { Prisma } from '../generated/prisma/client.ts';
import { PrismaService } from '../prisma/prisma.service.ts';

const DEFAULT_WINDOW_MS = 24 * 3_600_000;
const MILLISECONDS_PER_SECOND = 1_000;
const STORAGE_KEYS = ['storage_mm', 'storageMm'] as const;
const LEVEL_KEYS = ['level_mm', 'levelMm'] as const;

export interface BlockStateRecord {
  readonly blockId: string;
  readonly blockName: string;
  readonly storageMm: number | null;
  readonly levelMm: number | null;
  readonly confidence: number | null;
  readonly method: string | null;
  readonly ts: Date | null;
  readonly ageS: number | null;
  readonly stale: boolean;
  readonly state: Prisma.JsonValue | null;
  readonly covariance: Prisma.JsonValue | null;
}

export interface LossStateRecord {
  readonly zone: LossZone;
  readonly etaMean: number;
  readonly etaLower: number;
  readonly etaUpper: number;
  readonly identified: boolean;
  readonly validFrom: Date;
  readonly ageS: number;
}

export interface HistoryPointRecord {
  readonly blockId: string;
  readonly ts: Date;
  readonly storageMm: number | null;
  readonly confidence: number | null;
}

export interface EstimatesLatestRecord {
  readonly items: readonly BlockStateRecord[];
  readonly losses: readonly LossStateRecord[];
  readonly staleThresholdS: number;
}

export interface EstimatesHistoryQuery {
  readonly networkId?: string;
  readonly blockId?: string;
  readonly from?: Date;
  readonly to?: Date;
  readonly limit: number;
  readonly order: SortOrder;
}

export interface EstimatesHistoryRecord {
  readonly items: readonly HistoryPointRecord[];
  readonly from: Date;
  readonly to: Date;
  readonly limit: number;
}

interface BlockRow {
  readonly id: string;
  readonly name: string;
  readonly node: { readonly orderIdx: number | null } | null;
}

interface StateRow {
  readonly blockId: string | null;
  readonly ts: Date;
  readonly confidence: number | null;
  readonly method: string;
  readonly stateVector: Prisma.JsonValue;
  readonly covariance: Prisma.JsonValue;
}

interface LossRow {
  readonly zone: LossZone;
  readonly etaMean: number;
  readonly etaLower: number;
  readonly etaUpper: number;
  readonly identified: boolean;
  readonly validFrom: Date;
}

const BLOCK_SELECT = {
  id: true,
  name: true,
  node: { select: { orderIdx: true } },
} satisfies Prisma.BlockSelect;

const STATE_SELECT = {
  blockId: true,
  ts: true,
  confidence: true,
  method: true,
  stateVector: true,
  covariance: true,
} satisfies Prisma.StateEstimateSelect;

const LOSS_SELECT = {
  zone: true,
  etaMean: true,
  etaLower: true,
  etaUpper: true,
  identified: true,
  validFrom: true,
} satisfies Prisma.LossParameterSelect;

function isJsonObject(
  value: Prisma.JsonValue | null,
): value is Record<string, Prisma.JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pickNumber(
  source: Prisma.JsonValue | null,
  keys: readonly string[],
): number | null {
  if (!isJsonObject(source)) {
    return null;
  }
  for (const key of keys) {
    const candidate = source[key];
    if (typeof candidate === 'number') {
      return candidate;
    }
  }
  return null;
}

function compareBlockRows(a: BlockRow, b: BlockRow): number {
  const aIndex = a.node?.orderIdx ?? Number.MAX_SAFE_INTEGER;
  const bIndex = b.node?.orderIdx ?? Number.MAX_SAFE_INTEGER;
  if (aIndex !== bIndex) {
    return aIndex - bIndex;
  }
  const byName = a.name.localeCompare(b.name);
  return byName !== 0 ? byName : a.id.localeCompare(b.id);
}

function toBlockState(
  block: BlockRow,
  row: StateRow | null,
  nowMs: number,
  staleMs: number,
): BlockStateRecord {
  const ts = row?.ts ?? null;
  const ageMs = ts === null ? null : Math.max(0, nowMs - ts.getTime());
  return {
    blockId: block.id,
    blockName: block.name,
    storageMm: pickNumber(row?.stateVector ?? null, STORAGE_KEYS),
    levelMm: pickNumber(row?.stateVector ?? null, LEVEL_KEYS),
    confidence: row?.confidence ?? null,
    method: row?.method ?? null,
    ts,
    ageS: ageMs === null ? null : Math.round(ageMs / MILLISECONDS_PER_SECOND),
    stale: ageMs === null || ageMs > staleMs,
    state: row?.stateVector ?? null,
    covariance: row?.covariance ?? null,
  };
}

function toLossState(row: LossRow, nowMs: number): LossStateRecord {
  return {
    zone: row.zone,
    etaMean: row.etaMean,
    etaLower: row.etaLower,
    etaUpper: row.etaUpper,
    identified: row.identified,
    validFrom: row.validFrom,
    ageS: Math.max(
      0,
      Math.round(
        (nowMs - row.validFrom.getTime()) / MILLISECONDS_PER_SECOND,
      ),
    ),
  };
}

function toHistoryPoint(row: StateRow): HistoryPointRecord | null {
  if (row.blockId === null) {
    return null;
  }
  return {
    blockId: row.blockId,
    ts: row.ts,
    storageMm: pickNumber(row.stateVector, STORAGE_KEYS),
    confidence: row.confidence,
  };
}

@Injectable()
export class EstimatorReadService {
  private readonly staleThresholdS: number;
  private readonly staleMs: number;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
  ) {
    this.staleThresholdS = config.get('ESTIMATE_STALE_S', { infer: true });
    this.staleMs = this.staleThresholdS * MILLISECONDS_PER_SECOND;
  }

  async listLatest(networkId?: string): Promise<EstimatesLatestRecord> {
    const blocks = await this.loadBlocks(networkId);
    const latestByBlock = await this.loadLatestStates(
      blocks.map((block) => block.id),
    );
    const nowMs = Date.now();
    const items = [...blocks]
      .sort(compareBlockRows)
      .map((block) =>
        toBlockState(
          block,
          latestByBlock.get(block.id) ?? null,
          nowMs,
          this.staleMs,
        ),
      );
    const losses = await this.loadLosses(networkId, nowMs);
    return { items, losses, staleThresholdS: this.staleThresholdS };
  }

  async listHistory(
    query: EstimatesHistoryQuery,
  ): Promise<EstimatesHistoryRecord> {
    const to = query.to ?? new Date();
    const from = query.from ?? new Date(to.getTime() - DEFAULT_WINDOW_MS);
    const rows = await this.prisma.stateEstimate.findMany({
      where: {
        ts: { gte: from, lte: to },
        blockId: query.blockId === undefined ? { not: null } : query.blockId,
        ...(query.networkId === undefined
          ? {}
          : { networkId: query.networkId }),
      },
      orderBy: [{ ts: query.order }, { id: query.order }],
      take: query.limit,
      select: STATE_SELECT,
    });
    return {
      items: rows.flatMap((row) => {
        const point = toHistoryPoint(row);
        return point === null ? [] : [point];
      }),
      from,
      to,
      limit: query.limit,
    };
  }

  private async loadBlocks(networkId?: string): Promise<BlockRow[]> {
    return this.prisma.block.findMany({
      where: networkId === undefined ? {} : { networkId },
      select: BLOCK_SELECT,
    });
  }

  private async loadLatestStates(
    blockIds: readonly string[],
  ): Promise<Map<string, StateRow>> {
    if (blockIds.length === 0) {
      return new Map();
    }
    const grouped = await this.prisma.stateEstimate.groupBy({
      by: ['blockId'],
      where: { blockId: { in: [...blockIds] } },
      _max: { ts: true },
    });
    const pairs = grouped.flatMap((row) =>
      row.blockId === null || row._max.ts === null
        ? []
        : [{ blockId: row.blockId, ts: row._max.ts }],
    );
    if (pairs.length === 0) {
      return new Map();
    }
    const rows = await this.prisma.stateEstimate.findMany({
      where: { OR: pairs },
      orderBy: [{ ts: 'desc' }, { id: 'desc' }],
      select: STATE_SELECT,
    });
    const byBlock = new Map<string, StateRow>();
    for (const row of rows) {
      if (row.blockId !== null && !byBlock.has(row.blockId)) {
        byBlock.set(row.blockId, row);
      }
    }
    return byBlock;
  }

  private async loadLosses(
    networkId: string | undefined,
    nowMs: number,
  ): Promise<LossStateRecord[]> {
    const rows: LossRow[] = await this.prisma.lossParameter.findMany({
      where: {
        validTo: null,
        ...(networkId === undefined ? {} : { networkId }),
      },
      orderBy: [{ zone: 'asc' }, { id: 'asc' }],
      select: LOSS_SELECT,
    });
    return rows.map((row) => toLossState(row, nowMs));
  }
}