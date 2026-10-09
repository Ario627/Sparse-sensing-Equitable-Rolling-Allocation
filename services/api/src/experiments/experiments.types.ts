import type { ExperimentStatus } from '@sera/contracts';
import type { AuditContext } from '../common/audit/audit-context.ts';
import type { Prisma, Topology } from '../generated/prisma/client.ts';
import type { SolverExperimentRun } from '../solver/solver-experiments.client.ts';

export interface ExperimentProgressRecord {
  readonly runsDone: number;
  readonly medianRegret: number | null;
  readonly worstSr: number | null;
  readonly polledAt: Date;
}

export interface ExperimentRecord {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly networkId: string | null;
  readonly networkName: string | null;
  readonly status: ExperimentStatus;
  readonly seedBase: number | null;
  readonly configHash: string;
  readonly solverExperimentId: string | null;
  readonly runsTotal: number | null;
  readonly runsDone: number;
  readonly progress: ExperimentProgressRecord | null;
  readonly createdAt: Date;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
}

export interface ExperimentDetailRecord extends ExperimentRecord {
  readonly configYaml: string;
}

export interface ExperimentRunRecord {
  readonly runIndex: number;
  readonly scenarioId: string;
  readonly seed: number;
  readonly method: string;
  readonly sensorCount: number;
  readonly topology: Topology;
  readonly kFactor: number | null;
  readonly status: string;
  readonly parquetPath: string | null;
  readonly metrics: Prisma.JsonValue | null;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
}

export interface ExperimentListQuery {
  readonly status?: ExperimentStatus;
  readonly networkId?: string;
  readonly page: number;
  readonly limit: number;
}

export interface ExperimentListPage {
  readonly items: readonly ExperimentRecord[];
  readonly total: number;
}

export interface ExperimentRunListQuery {
  readonly page: number;
  readonly limit: number;
}

export interface ExperimentRunListPage {
  readonly items: readonly ExperimentRunRecord[];
  readonly total: number;
}

export interface ActiveExperimentRecord {
  readonly id: string;
  readonly solverExperimentId: string;
  readonly networkId: string | null;
  readonly status: ExperimentStatus;
  readonly runsTotal: number | null;
  readonly progress: ExperimentProgressRecord | null;
}

export interface ExperimentCreateData {
  readonly name: string;
  readonly description: string | null;
  readonly networkId: string | null;
  readonly configYaml: string;
  readonly configHash: string;
  readonly seedBase: number | null;
  readonly status: ExperimentStatus;
  readonly solverExperimentId: string;
  readonly runsTotal: number | null;
  readonly actorId: string;
  readonly audit: AuditContext;
}

export interface ExperimentPollRunInput {
  readonly runIndex: number;
  readonly scenarioId: string;
  readonly seed: number;
  readonly method: string;
  readonly sensorCount: number;
  readonly topology: Topology;
  readonly kFactor: number | null;
  readonly status: string;
  readonly parquetPath: string | null;
  readonly metrics: SolverExperimentRun['metrics'];
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
}

export interface ExperimentPollUpdate {
  readonly status: ExperimentStatus;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
  readonly runsDone: number;
  readonly runsTotal: number | null;
  readonly medianRegret: number | null;
  readonly worstSr: number | null;
  readonly polledAt: Date;
  readonly runs: readonly ExperimentPollRunInput[];
}
