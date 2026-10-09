export const LEDGER_ENTITY = 'IrrigationNetwork';
export const LEDGER_AUDIT_ACTION = 'ledger.settle';

export const MILLISECONDS_PER_HOUR = 3_600_000;
export const SECONDS_PER_HOUR = 3_600;
export const LEDGER_LOOKBACK_H = 48;
export const LEDGER_MAX_PERIODS_PER_TICK = 8;
export const LEDGER_STALE_PERIODS = 2;
export const DEFAULT_SERVICE_RATIO = 1;

export const TARGET_STRATEGY_WATER_BALANCE = 'water_balance';
export const TARGET_STRATEGY_CAPACITY = 'capacity';

export const LEDGER_MESSAGES = {
  networkNotFound: 'Network not found',
} as const;
