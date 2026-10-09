import type { Prisma } from '../generated/prisma/client.ts';
import { toJsonInput } from '../common/prisma/json.ts';
import type {
  SolverEstimateLoss,
  SolverEstimateState,
} from '../solver/solver-estimate.client.ts';
import { ETA_CHANGE_EPSILON } from './estimator.constants.ts';
import type {
  EstimateObservationRow,
  EstimatePreviousStateRow,
  LossWritePlan,
  OpenLossRow,
} from './estimator.types.ts';

export const NETWORK_SELECT = {
  id: true,
  name: true,
  topology: true,
} satisfies Prisma.IrrigationNetworkSelect;

export const NETWORK_NODE_SELECT = {
  id: true,
  type: true,
  name: true,
  orderIdx: true,
} satisfies Prisma.NodeSelect;

export const NETWORK_EDGE_SELECT = {
  id: true,
  fromNodeId: true,
  toNodeId: true,
  capacityLps: true,
  zone: true,
  lengthM: true,
} satisfies Prisma.EdgeSelect;

export const NETWORK_BLOCK_SELECT = {
  id: true,
  nodeId: true,
  name: true,
  areaM2: true,
  cropType: true,
  nominalFlowLps: true,
  distanceFromSourceM: true,
} satisfies Prisma.BlockSelect;

export const OBSERVATION_SELECT = {
  sensorId: true,
  ts: true,
  value: true,
  quality: true,
  sensor: {
    select: {
      id: true,
      type: true,
      unit: true,
      nodeId: true,
      node: { select: { block: { select: { id: true } } } },
    },
  },
} satisfies Prisma.SensorReadingSelect;

export type ObservationRow = Prisma.SensorReadingGetPayload<{
  select: typeof OBSERVATION_SELECT;
}>;

export const PREVIOUS_STATE_SELECT = {
  blockId: true,
  ts: true,
  stateVector: true,
  covariance: true,
} satisfies Prisma.StateEstimateSelect;

export type PreviousStateRow = Prisma.StateEstimateGetPayload<{
  select: typeof PREVIOUS_STATE_SELECT;
}>;

export const OPEN_LOSS_SELECT = {
  id: true,
  zone: true,
  etaMean: true,
  identified: true,
} satisfies Prisma.LossParameterSelect;

export type OpenLossRawRow = Prisma.LossParameterGetPayload<{
  select: typeof OPEN_LOSS_SELECT;
}>;

export function toObservation(
  row: ObservationRow,
): EstimateObservationRow | null {
  const nodeId = row.sensor.nodeId;
  if (nodeId === null) {
    return null;
  }
  return {
    sensorId: row.sensorId,
    nodeId,
    blockId: row.sensor.node?.block?.id ?? null,
    type: row.sensor.type,
    unit: row.sensor.unit,
    value: row.value,
    quality: row.quality,
    ts: row.ts,
  };
}

export function toPreviousState(
  row: PreviousStateRow,
): EstimatePreviousStateRow | null {
  if (row.blockId === null) {
    return null;
  }
  return {
    blockId: row.blockId,
    ts: row.ts,
    stateVector: row.stateVector,
    covariance: row.covariance,
  };
}

export function toStateCreateRows(
  networkId: string,
  ts: Date,
  states: readonly SolverEstimateState[],
): Prisma.StateEstimateCreateManyInput[] {
  return states.map((state) => ({
    networkId,
    blockId: state.block_id,
    ts,
    stateVector: state.state as Prisma.InputJsonValue,
    covariance: state.covariance as Prisma.InputJsonValue,
    confidence: state.confidence,
    method: state.method,
  }));
}

export function buildLossWritePlan(
  networkId: string,
  ts: Date,
  openLosses: readonly OpenLossRow[],
  incoming: readonly SolverEstimateLoss[],
): LossWritePlan {
  const openByZone = new Map(openLosses.map((row) => [row.zone, row]));
  const closeIds: string[] = [];
  const createRows: Prisma.LossParameterCreateManyInput[] = [];
  for (const loss of incoming) {
    const open = openByZone.get(loss.zone);
    const unchanged =
      open !== undefined &&
      open.identified === loss.identified &&
      Math.abs(open.etaMean - loss.eta_mean) < ETA_CHANGE_EPSILON;
    if (unchanged) {
      continue;
    }
    if (open !== undefined) {
      closeIds.push(open.id);
    }
    createRows.push({
      networkId,
      zone: loss.zone,
      etaMean: loss.eta_mean,
      etaLower: loss.eta_lower,
      etaUpper: loss.eta_upper,
      identified: loss.identified,
      identifiabilityJson: toJsonInput(loss.diagnostics),
      validFrom: ts,
    });
  }
  return { closeIds, createRows };
}
