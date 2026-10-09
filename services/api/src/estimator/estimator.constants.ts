export const ETA_CHANGE_EPSILON = 0.01;

export const ESTIMATOR_MESSAGES = {
  solverUnavailable: 'solver unavailable during estimate run',
  solverRejected: 'solver rejected the estimate request',
  solverContract: 'solver returned an invalid estimate',
} as const;
