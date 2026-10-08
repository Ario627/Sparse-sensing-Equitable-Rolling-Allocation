import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../common/config/env.ts';
import { buildSolverNetwork } from '../solver/network-payload.ts';
import {
  SolverContractError,
  SolverRejectedError,
  SolverUnavailableError,
} from '../solver/solver-http.service.ts';
import {
  SolverEstimateClient,
  type SolverEstimateResult,
  type SolverObservationInput,
  type SolverPreviousStateInput,
} from '../solver/solver-estimate.client.ts';
import { ESTIMATOR_MESSAGES } from './estimator.constants.ts';
import { EstimatorRepository } from './estimator.repository.ts';
import { buildLossWritePlan } from './estimator.selects.ts';
import type {
  EstimateNetworkRow,
  EstimateRunOutcome,
  EstimateRunSummary,
} from './estimator.types.ts';

const MILLISECONDS_PER_MINUTE = 60_000;

@Injectable()
export class EstimatorService {
  private readonly logger = new Logger(EstimatorService.name);
  private readonly windowMinutes: number;
  private readonly maxObservations: number;
  private readonly batchNetworks: number;
  private readonly watermarks = new Map<string, Date>();

  constructor(
    private readonly repository: EstimatorRepository,
    private readonly solver: SolverEstimateClient,
    config: ConfigService<Env, true>,
  ) {
    this.windowMinutes = config.get('ESTIMATOR_WINDOW_MIN', { infer: true });
    this.maxObservations = config.get('ESTIMATOR_MAX_OBSERVATIONS', {
      infer: true,
    });
    this.batchNetworks = config.get('ESTIMATOR_BATCH_NETWORKS', {
      infer: true,
    });
  }

  async runOnce(): Promise<EstimateRunSummary> {
    const networks = await this.repository.listNetworks();
    const selected = networks.slice(0, this.batchNetworks);
    let estimated = 0;
    let failed = 0;
    for (const network of selected) {
      const outcome = await this.estimateNetwork(network);
      if (outcome === 'estimated') {
        estimated += 1;
      }
      if (outcome === 'failed') {
        failed += 1;
      }
    }
    return { networks: selected.length, estimated, failed };
  }

  private async estimateNetwork(
    network: EstimateNetworkRow,
  ): Promise<EstimateRunOutcome> {
    const startedAt = new Date();
    const watermark = await this.resolveWatermark(network.id);
    if (!(await this.repository.hasNewReadings(network.id, watermark))) {
      return 'skipped';
    }
    const since = new Date(
      startedAt.getTime() - this.windowMinutes * MILLISECONDS_PER_MINUTE,
    );
    const observations = await this.repository.loadObservations(
      network.id,
      since,
      this.maxObservations,
    );
    if (observations.length === 0) {
      return 'skipped';
    }
    const [graph, previousRows, openLosses] = await Promise.all([
      this.repository.loadNetworkGraph(network.id),
      this.repository.loadPreviousStates(network.id),
      this.repository.loadOpenLosses(network.id),
    ]);
    try {
      const result = await this.requestEstimate(
        network,
        graph.nodes,
        graph.edges,
        graph.blocks,
        observations,
        previousRows,
      );
      const ts = new Date(result.ts);
      await this.repository.persistEstimate({
        networkId: network.id,
        ts,
        states: result.states,
        lossPlan: buildLossWritePlan(network.id, ts, openLosses, result.losses),
      });
      this.watermarks.set(network.id, startedAt);
      this.logger.debug(
        `estimate stored for ${network.name}: ${result.states.length} states, ${result.losses.length} losses`,
      );
      return 'estimated';
    } catch (error) {
      this.reportFailure(network.id, error);
      return 'failed';
    }
  }

  private reportFailure(networkId: string, error: unknown): void {
    if (error instanceof SolverUnavailableError) {
      this.logger.debug(
        `${ESTIMATOR_MESSAGES.solverUnavailable}: ${networkId}`,
      );
      return;
    }
    if (error instanceof SolverRejectedError) {
      this.logger.warn(
        `${ESTIMATOR_MESSAGES.solverRejected} (${error.status}): ${networkId}`,
      );
      return;
    }
    if (error instanceof SolverContractError) {
      this.logger.warn(`${ESTIMATOR_MESSAGES.solverContract}: ${networkId}`);
      return;
    }
    this.logger.error(
      `estimate run failed: ${networkId}`,
      error instanceof Error ? error.stack : undefined,
    );
  }

  private async resolveWatermark(networkId: string): Promise<Date> {
    const cached = this.watermarks.get(networkId);
    if (cached !== undefined) {
      return cached;
    }
    const latest = await this.repository.maxEstimateTs(networkId);
    const resolved = latest ?? new Date(0);
    this.watermarks.set(networkId, resolved);
    return resolved;
  }

  private requestEstimate(
    network: EstimateNetworkRow,
    nodes: Parameters<typeof buildSolverNetwork>[1],
    edges: Parameters<typeof buildSolverNetwork>[2],
    blocks: Parameters<typeof buildSolverNetwork>[3],
    observations: readonly SolverObservationInput[],
    previousRows: readonly {
      readonly blockId: string;
      readonly ts: Date;
      readonly stateVector: unknown;
      readonly covariance: unknown;
    }[],
  ): Promise<SolverEstimateResult> {
    return this.solver.requestEstimate({
      network: buildSolverNetwork(network, nodes, edges, blocks),
      observations,
      statePrev:
        previousRows.length === 0
          ? null
          : previousRows.map(
              (row): SolverPreviousStateInput => ({
                blockId: row.blockId,
                ts: row.ts,
                state: row.stateVector,
                covariance: row.covariance,
              }),
            ),
      windowMinutes: this.windowMinutes,
    });
  }
}
