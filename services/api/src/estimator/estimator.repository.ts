import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.ts';
import {
  NETWORK_BLOCK_SELECT,
  NETWORK_EDGE_SELECT,
  NETWORK_NODE_SELECT,
  NETWORK_SELECT,
  OBSERVATION_SELECT,
  OPEN_LOSS_SELECT,
  PREVIOUS_STATE_SELECT,
  toObservation,
  toPreviousState,
  toStateCreateRows,
  type ObservationRow,
  type PreviousStateRow,
} from './estimator.selects.ts';
import type {
  EstimateNetworkGraph,
  EstimateNetworkRow,
  EstimateObservationRow,
  EstimatePreviousStateRow,
  OpenLossRow,
  PersistEstimateInput,
} from './estimator.types.ts';

const OBSERVATION_QUALITIES = ['GOOD', 'SUSPECT'] as const;

function dedupeLatestBySensor(
  rows: readonly EstimateObservationRow[],
): EstimateObservationRow[] {
  const latest = new Map<string, EstimateObservationRow>();
  for (const row of rows) {
    const current = latest.get(row.sensorId);
    if (current === undefined || row.ts.getTime() > current.ts.getTime()) {
      latest.set(row.sensorId, row);
    }
  }
  return [...latest.values()];
}

@Injectable()
export class EstimatorRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listNetworks(): Promise<EstimateNetworkRow[]> {
    return this.prisma.irrigationNetwork.findMany({
      where: { sensors: { some: { isActive: true } } },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: NETWORK_SELECT,
    });
  }

  async loadNetworkGraph(networkId: string): Promise<EstimateNetworkGraph> {
    const [nodes, edges, blocks] = await Promise.all([
      this.prisma.node.findMany({
        where: { networkId },
        select: NETWORK_NODE_SELECT,
        orderBy: [{ orderIdx: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.edge.findMany({
        where: { networkId },
        select: NETWORK_EDGE_SELECT,
        orderBy: { id: 'asc' },
      }),
      this.prisma.block.findMany({
        where: { networkId },
        select: NETWORK_BLOCK_SELECT,
        orderBy: { name: 'asc' },
      }),
    ]);
    return { nodes, edges, blocks };
  }

  async hasNewReadings(networkId: string, since: Date): Promise<boolean> {
    const count = await this.prisma.sensorReading.count({
      where: {
        receivedAt: { gt: since },
        quality: { in: [...OBSERVATION_QUALITIES] },
        sensor: { networkId, isActive: true },
      },
    });
    return count > 0;
  }

  async maxEstimateTs(networkId: string): Promise<Date | null> {
    const result = await this.prisma.stateEstimate.aggregate({
      where: { networkId },
      _max: { ts: true },
    });
    return result._max.ts;
  }

  async loadObservations(
    networkId: string,
    since: Date,
    limit: number,
  ): Promise<EstimateObservationRow[]> {
    const rows: ObservationRow[] = await this.prisma.sensorReading.findMany({
      where: {
        receivedAt: { gte: since },
        quality: { in: [...OBSERVATION_QUALITIES] },
        sensor: { networkId, isActive: true },
      },
      orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
      take: limit,
      select: OBSERVATION_SELECT,
    });
    return dedupeLatestBySensor(
      rows.flatMap((row) => {
        const mapped = toObservation(row);
        return mapped === null ? [] : [mapped];
      }),
    );
  }

  async loadPreviousStates(
    networkId: string,
  ): Promise<EstimatePreviousStateRow[]> {
    const grouped = await this.prisma.stateEstimate.groupBy({
      by: ['blockId'],
      where: { networkId, blockId: { not: null } },
      _max: { ts: true },
    });
    const pairs = grouped.flatMap((row) =>
      row.blockId === null || row._max.ts === null
        ? []
        : [{ blockId: row.blockId, ts: row._max.ts }],
    );
    if (pairs.length === 0) {
      return [];
    }
    const rows: PreviousStateRow[] = await this.prisma.stateEstimate.findMany({
      where: { OR: pairs },
      orderBy: [{ ts: 'desc' }, { id: 'desc' }],
      select: PREVIOUS_STATE_SELECT,
    });
    const byBlock = new Map<string, EstimatePreviousStateRow>();
    for (const row of rows) {
      const mapped = toPreviousState(row);
      if (mapped !== null && !byBlock.has(mapped.blockId)) {
        byBlock.set(mapped.blockId, mapped);
      }
    }
    return [...byBlock.values()];
  }

  async loadOpenLosses(networkId: string): Promise<OpenLossRow[]> {
    return this.prisma.lossParameter.findMany({
      where: { networkId, validTo: null },
      orderBy: [{ zone: 'asc' }, { id: 'asc' }],
      select: OPEN_LOSS_SELECT,
    });
  }

  async persistEstimate(input: PersistEstimateInput): Promise<void> {
    const stateRows = toStateCreateRows(
      input.networkId,
      input.ts,
      input.states,
    );
    await this.prisma.$transaction(async (tx) => {
      await tx.stateEstimate.createMany({ data: stateRows });
      if (input.lossPlan.closeIds.length > 0) {
        await tx.lossParameter.updateMany({
          where: {
            id: { in: [...input.lossPlan.closeIds] },
            validTo: null,
          },
          data: { validTo: input.ts },
        });
      }
      if (input.lossPlan.createRows.length > 0) {
        await tx.lossParameter.createMany({
          data: [...input.lossPlan.createRows],
        });
      }
    });
  }
}