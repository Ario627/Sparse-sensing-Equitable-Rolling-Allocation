import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../common/config/env.ts';
import { DomainEventBus } from '../common/events/domain-event-bus.service.ts';
import {
  SolverContractError,
  SolverRejectedError,
  SolverUnavailableError,
} from '../solver/solver-http.service.ts';
import {
  SolverExperimentsClient,
  type SolverExperimentStatusResult,
} from '../solver/solver-experiments.client.ts';
import {
  POLL_BATCH_SIZE,
  TERMINAL_EXPERIMENT_STATUSES,
} from './experiments.constant.ts';
import { ExperimentsRepository } from './experiments.repository.ts';
import {
  parseIsoDate,
  toPollRun,
  toProgressEvent,
} from './experiments.selects.ts';
import type {
  ActiveExperimentRecord,
  ExperimentPollUpdate,
} from './experiments.types.ts';

@Injectable()
export class ExperimentsProgressService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ExperimentsProgressService.name);
  private readonly pollIntervalMs: number;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly repository: ExperimentsRepository,
    private readonly solver: SolverExperimentsClient,
    private readonly events: DomainEventBus,
    config: ConfigService<Env, true>,
  ) {
    // EXPERIMENT_POLL_INTERVAL_S is not part of the typed Env schema yet.
    const rawIntervalSeconds = (
      config as unknown as ConfigService<Record<string, unknown>>
    ).get<string | number>('EXPERIMENT_POLL_INTERVAL_S');
    const intervalSeconds = Number(rawIntervalSeconds);
    this.pollIntervalMs =
      (Number.isFinite(intervalSeconds) && intervalSeconds > 0
        ? intervalSeconds
        : 5) * 1_000;
  }

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.pollOnce();
    }, this.pollIntervalMs);
  }

  onModuleDestroy(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private async pollOnce(): Promise<void> {
    const active = await this.repository.findActiveExperiments(POLL_BATCH_SIZE);
    for (const entry of active) {
      await this.pollExperiment(entry);
    }
  }

  private async pollExperiment(entry: ActiveExperimentRecord): Promise<void> {
    let status: SolverExperimentStatusResult;
    try {
      status = await this.solver.fetchExperiment(entry.solverExperimentId);
    } catch (error) {
      this.reportPollFailure(entry.id, error);
      return;
    }
    const polledAt = new Date();
    const isTerminal = TERMINAL_EXPERIMENT_STATUSES.includes(status.status);
    const update: ExperimentPollUpdate = {
      status: status.status,
      startedAt: parseIsoDate(status.started_at),
      finishedAt: parseIsoDate(status.finished_at),
      runsDone: status.runs_done,
      runsTotal: status.runs_total ?? null,
      medianRegret: status.median_regret ?? null,
      worstSr: status.worst_sr ?? null,
      polledAt,
      runs: (status.runs ?? []).map(toPollRun),
    };
    const runsDone = await this.repository.applyPollUpdate(
      entry.id,
      update,
      isTerminal ? polledAt : null,
    );
    const statusChanged = entry.status !== update.status;
    const runsDoneChanged =
      entry.progress === null || entry.progress.runsDone !== update.runsDone;
    if (!statusChanged && !runsDoneChanged) {
      return;
    }
    const runsTotal = update.runsTotal ?? entry.runsTotal;
    const progressEvent = toProgressEvent({
      experimentId: entry.id,
      networkId: null,
      status: update.status,
      runsDone: update.runsDone,
      runsTotal,
      medianRegret: update.medianRegret,
      worstSr: update.worstSr,
    });
    if (progressEvent !== null) {
      this.events.publish(progressEvent);
    }
    this.logger.debug(
      `experiment ${entry.id}: ${entry.status} -> ${update.status} (runs ${runsDone})`,
    );
  }

  private reportPollFailure(experimentId: string, error: unknown): void {
    if (error instanceof SolverUnavailableError) {
      this.logger.debug(
        `experiment poll skipped (solver down): ${experimentId}`,
      );
      return;
    }
    if (error instanceof SolverRejectedError) {
      this.logger.warn(
        `experiment poll rejected (${error.status}): ${experimentId}`,
      );
      return;
    }
    if (error instanceof SolverContractError) {
      this.logger.warn(`experiment poll contract error: ${experimentId}`);
      return;
    }
    throw error;
  }
}
