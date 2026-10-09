export const COMMAND_ACK_SUFFIX = 'command/ack';
export const COMMAND_SWEEP_INTERVAL_MS = 15_000;
export const COMMAND_SWEEP_BATCH = 50;

export const EVENT_TYPE_ALERT = 'alert';
export const EVENT_TYPE_SYSTEM = 'system';
export const SEVERITY_WARNING = 'warning';
export const GATE_MISMATCH_ALERT_CODE = 'gate_mismatch';

export const GATE_COMMAND_STATUS = {
  pending: 'pending',
  accepted: 'accepted',
  rejected: 'rejected',
  expired: 'expired',
  unanswered: 'unanswered',
} as const;

export const UNKNOWN_COMMAND_MESSAGE =
  'command ack references an unknown command';
export const INVALID_ACK_MESSAGE = 'command ack payload is invalid';
export const DEVICE_MISMATCH_MESSAGE =
  'command ack arrived from an unexpected device';
export const CONFLICTING_ACK_MESSAGE =
  'command ack conflicts with the stored command status';
export const CORRUPT_COMMAND_MESSAGE = 'stored command payload is invalid';
export const REJECTED_COMMAND_MESSAGE = 'gate command rejected by device';
export const EXPIRED_ON_DEVICE_MESSAGE = 'gate command expired on device';
export const EXPIRED_NO_ACK_MESSAGE =
  'gate command expired without acknowledgement';
export const MISMATCH_EVENT_MESSAGE =
  'gate did not follow the commanded position';
