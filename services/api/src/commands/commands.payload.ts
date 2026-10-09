import { commandSchema, type Command, type CommandAck } from '@sera/contracts';
import { z } from 'zod';
import type {
  GateMismatchVerdict,
  StoredCommandPayload,
} from './commands.types.ts';

const MISMATCH_REFERENCE_PCT = { open: 100, close: 0 } as const;

const storedCommandPayloadSchema = z.strictObject({
  device_id: z.string().min(1).max(64),
  command: commandSchema,
});

export function isCommandAction(value: string): value is Command['action'] {
  return value === 'open' || value === 'close' || value === 'set_position';
}

export function parseJsonPayload(payload: Buffer): unknown | null {
  try {
    return JSON.parse(payload.toString('utf-8'));
  } catch {
    return null;
  }
}

export function parseStoredPayload(
  value: unknown,
): StoredCommandPayload | null {
  const parsed = storedCommandPayloadSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function expectedPositionPct(action: Command['action']): number | null {
  return action === 'open' || action === 'close'
    ? MISMATCH_REFERENCE_PCT[action]
    : null;
}

export function evaluateGateMismatch(
  action: Command['action'],
  reportedPct: number,
  tolerancePct: number,
): GateMismatchVerdict | null {
  const expectedPct = expectedPositionPct(action);
  if (expectedPct === null) {
    return null;
  }

  const deviationPct = Math.abs(reportedPct - expectedPct);
  return deviationPct > tolerancePct
    ? { expectedPct, deviationPct: Math.round(deviationPct) }
    : null;
}

export function isCommandExpired(command: Command, now: Date): boolean {
  return Date.parse(command.expires_at) <= now.getTime();
}

export function commandReference(ack: CommandAck): string {
  return `plan command ${ack.command_id}`;
}

