import { createHash } from 'node:crypto';
import {
  BadGatewayException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuditContext } from '../common/audit/audit-context.ts';
import type { Env } from '../common/config/env.ts';
import { DomainEventBus } from '../common/events/domain-event-bus.service.ts';
import {
  SolverContractError,
  SolverRejectedError,
  SolverUnavailableError,
} from '../solver/solver-http.service.ts';
import {
  SolverExperimentsClient,
  type SolverExperimentStartResult,
} from '../solver/solver-experiments.client.ts';
import {
  ACTIVE_EXPERIMENT_STATUSES,
  EXPERIMENT_MESSAGES,
} from './experiments.constant.ts';
import { ExperimentsRepository } from './experiments.repository.ts';
import { toProgressEvent } from './experiments.selects.ts';
import type {
  ExperimentDetailRecord,
  ExperimentListPage,
  ExperimentListQuery,
  ExperimentRunListPage,
  ExperimentRunListQuery,
} from './experiments.types.ts';

export interface CreateExperimentInput {
  readonly name: string;
  readonly description: string | null;
  readonly networkId?: string;
  readonly configYaml: string;
  readonly seedBase?: number;
}

@Injectable()
export class ExperimentsService {
  private readonly maxRuns: number;

  constructor(
    private readonly repository: ExperimentsRepository,
    private readonly solver: SolverExperimentsClient,
    private readonly events: DomainEventBus,
    config: ConfigService<Env, true>,
  ) {
    this.maxRuns = config.get('EXPERIMENT_MAX_RUNS', { infer: true });
  }

  list(query: ExperimentListQuery): Promise<ExperimentListPage> {
    return this.repository.listExperiments(query);
  }

  async getById(id: string): Promise<ExperimentDetailRecord> {
    const detail = await this.repository.findExperimentDetail(id);
    if (detail === null) {
      throw new NotFoundException(EXPERIMENT_MESSAGES.notFound);
    }
    return detail;
  }

  async listRuns(
    id: string,
    query: ExperimentRunListQuery,
  ): Promise<ExperimentRunListPage> {
    const experiment = await this.repository.findExperimentById(id);
    if (experiment === null) {
      throw new NotFoundException(EXPERIMENT_MESSAGES.notFound);
    }
    return this.repository.listRuns(id, query);
  }

  async create(
    actorId: string,
    input: CreateExperimentInput,
    audit: AuditContext,
  ): Promise<ExperimentDetailRecord> {
    if (input.networkId !== undefined) {
      const exists = await this.repository.networkExists(input.networkId);
      if (!exists) {
        throw new NotFoundException(EXPERIMENT_MESSAGES.networkNotFound);
      }
    }
    let start: SolverExperimentStartResult;
    try {
      start = await this.solver.startExperiment({
        configYaml: input.configYaml,
        seedBase: input.seedBase ?? null,
        maxRuns: this.maxRuns,
      });
    } catch (error) {
      if (error instanceof SolverRejectedError) {
        throw new BadGatewayException(EXPERIMENT_MESSAGES.solverRejected);
      }
      if (error instanceof SolverContractError) {
        throw new BadGatewayException(EXPERIMENT_MESSAGES.solverContract);
      }
      if (error instanceof SolverUnavailableError) {
        throw new ServiceUnavailableException(
          EXPERIMENT_MESSAGES.solverUnavailable,
        );
      }
      throw error;
    }
    const configHash =
      start.config_hash ??
      createHash('sha256').update(input.configYaml).digest('hex');
    const id = await this.repository.createExperiment({
      name: input.name,
      description: input.description,
      networkId: input.networkId ?? null,
      configYaml: input.configYaml,
      configHash,
      seedBase: input.seedBase ?? null,
      status: start.status,
      solverExperimentId: start.experiment_id,
      runsTotal: start.runs_total ?? null,
      actorId,
      audit,
    });
    return this.getById(id);
  }

  async cancel(
    actorId: string,
    id: string,
    audit: AuditContext,
  ): Promise<ExperimentDetailRecord> {
    const experiment = await this.repository.findExperimentById(id);
    if (experiment === null) {
      throw new NotFoundException(EXPERIMENT_MESSAGES.notFound);
    }
    if (!ACTIVE_EXPERIMENT_STATUSES.includes(experiment.status)) {
      throw new ConflictException(EXPERIMENT_MESSAGES.cancelNotAllowed);
    }
    let solverOutcome = 'unsupported';
    if (experiment.solverExperimentId !== null) {
      try {
        solverOutcome = await this.solver.cancelExperiment(
          experiment.solverExperimentId,
        );
      } catch (error) {
        if (!(error instanceof SolverUnavailableError)) {
          throw error;
        }
        solverOutcome = 'unavailable';
      }
    }
    const claimed = await this.repository.markCancelled(
      id,
      actorId,
      audit,
      experiment.status,
      solverOutcome,
    );
    if (!claimed) {
      throw new ConflictException(EXPERIMENT_MESSAGES.cancelNotAllowed);
    }
    const updated = await this.getById(id);
    const progressEvent = toProgressEvent({
      experimentId: updated.id,
      networkId: updated.networkId,
      status: updated.status,
      runsDone: updated.runsDone,
      runsTotal: updated.runsTotal,
      medianRegret: updated.progress?.medianRegret ?? null,
      worstSr: updated.progress?.worstSr ?? null,
    });
    if (progressEvent !== null) {
      this.events.publish(progressEvent);
    }
    return updated;
  }
}
