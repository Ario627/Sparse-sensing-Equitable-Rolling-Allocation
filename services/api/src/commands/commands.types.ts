import type { Command, CommandAck } from '@sera/contracts';
import type { Prisma } from '../generated/prisma/client.ts';

export interface StoredCommandPayload {
  readonly device_id: string;
  readonly command: Command;
}

export interface CommandStateRow {
  readonly id: string;
  readonly commandId: string;
  readonly sensorId: string | null;
  readonly action: string;
  readonly status: string;
  readonly payload: Prisma.JsonValue | null;
}

export interface GateMismatchVerdict {
  readonly expectedPct: number;
  readonly deviationPct: number;
}

export interface AckRecording {
  readonly recorded: boolean;
  readonly alertEventId: string | null;
}

export interface AckOutcome {
  readonly ack: CommandAck;
}