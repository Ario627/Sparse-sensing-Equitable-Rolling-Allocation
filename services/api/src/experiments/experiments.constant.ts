import type { ExperimentStatus } from '@sera/contracts';

export const EXPERIMENT_ENTITY = 'Experiment';
export const START_AUDIT_ACTION = 'experiment.start';
export const CANCEL_AUDIT_ACTION = 'experiment.cancel';
export const POLL_BATCH_SIZE = 10;

export const ACTIVE_EXPERIMENT_STATUSES: readonly ExperimentStatus[] = [
  'QUEUED',
  'RUNNING',
];

export const TERMINAL_EXPERIMENT_STATUSES: readonly ExperimentStatus[] = [
  'COMPLETED',
  'FAILED',
  'CANCELLED',
];

export const EXPERIMENT_MESSAGES = {
  notFound: 'Experiment not found',
  networkNotFound: 'Network not found',
  solverUnavailable: 'Solver is unavailable; experiment was not started',
  solverRejected: 'Solver rejected the experiment request',
  solverContract: 'Solver returned an invalid experiment response',
  cancelNotAllowed: 'Only queued or running experiments can be cancelled',
} as const;
