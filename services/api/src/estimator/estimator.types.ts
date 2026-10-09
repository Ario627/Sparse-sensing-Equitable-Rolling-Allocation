import type { LossZone, ReadingQuality, SensorType } from '@sera/contracts';
import type { Prisma } from '../generated/prisma/client.ts';
import type { SolverEstimateState } from '../solver/solver-estimate.client.ts';

export interface EstimateNetworkRow {
  readonly id: string;
  readonly name: string;
  readonly topology: string;
}

export interface EstimateNetworkNodeRow {
  readonly id: string;
  readonly type: string;
  readonly name: string;
  readonly orderIdx: number | null;
}

export interface EstimateNetworkEdgeRow {
  readonly id: string;
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly capacityLps: number;
  readonly zone: string;
  readonly lengthM: number | null;
}

export interface EstimateNetworkBlockRow {
  readonly id: string;
  readonly nodeId: string;
  readonly name: string;
  readonly areaM2: number;
  readonly cropType: string;
  readonly nominalFlowLps: number;
  readonly distanceFromSourceM: number | null;
}

export interface EstimateNetworkGraph {
  readonly nodes: readonly EstimateNetworkNodeRow[];
  readonly edges: readonly EstimateNetworkEdgeRow[];
  readonly blocks: readonly EstimateNetworkBlockRow[];
}

export interface EstimateObservationRow {
  readonly sensorId: string;
  readonly nodeId: string;
  readonly blockId: string | null;
  readonly type: SensorType;
  readonly unit: string;
  readonly value: number;
  readonly quality: ReadingQuality;
  readonly ts: Date;
}

export interface EstimatePreviousStateRow {
  readonly blockId: string;
  readonly ts: Date;
  readonly stateVector: Prisma.JsonValue;
  readonly covariance: Prisma.JsonValue;
}

export interface OpenLossRow {
  readonly id: string;
  readonly zone: LossZone;
  readonly etaMean: number;
  readonly identified: boolean;
}

export interface LossWritePlan {
  readonly closeIds: readonly string[];
  readonly createRows: readonly Prisma.LossParameterCreateManyInput[];
}

export interface PersistEstimateInput {
  readonly networkId: string;
  readonly ts: Date;
  readonly states: readonly SolverEstimateState[];
  readonly lossPlan: LossWritePlan;
}

export type EstimateRunOutcome = 'skipped' | 'estimated' | 'failed';

export interface EstimateRunSummary {
  readonly networks: number;
  readonly estimated: number;
  readonly failed: number;
}
