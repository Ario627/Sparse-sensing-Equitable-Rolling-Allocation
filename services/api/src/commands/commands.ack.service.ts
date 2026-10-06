import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { commandAckSchema, type CommandAck } from '@sera/contracts';
import type { Env } from '../common/config/env.ts';
import { Prisma } from '../generated/prisma/client.ts';
import { DomainEventBus } from '../common/events/domain-event-bus.service.ts';
import { MqttService, type MqttMessage } from '../mqtt/mqtt.service.ts';
import { parseSeraTopic, type ParsedSeraTopic } from '../mqtt/mqtt.topic.ts';
import { PrismaService } from '../prisma/prisma.service.ts';
import type {
  CommandStateRow,
  StoredCommandPayload,
} from './commands.types.ts';
import {
  COMMAND_ACK_SUFFIX,
  CONFLICTING_ACK_MESSAGE,
  CORRUPT_COMMAND_MESSAGE,
  DEVICE_MISMATCH_MESSAGE,
  EVENT_TYPE_ALERT,
  EVENT_TYPE_SYSTEM,
  EXPIRED_ON_DEVICE_MESSAGE,
  GATE_COMMAND_STATUS,
  GATE_MISMATCH_ALERT_CODE,
  INVALID_ACK_MESSAGE,
  MISMATCH_EVENT_MESSAGE,
  REJECTED_COMMAND_MESSAGE,
  SEVERITY_WARNING,
  UNKNOWN_COMMAND_MESSAGE,
} from './commands.constants.ts';
import {
  commandReference,
  evaluateGateMismatch,
  isCommandAction,
  parseJsonPayload,
  parseStoredPayload,
} from './commands.payload.ts';


interface EventInput {
  readonly type: string;
  readonly severity: string;
  readonly message: string;
  readonly payload: Record<string, unknown>;
}

@Injectable()
export class CommandAckService implements OnModuleInit {
  private readonly logger = new Logger(CommandAckService.name);
  private readonly prefix: string;
  private readonly tolerancePct: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEventBus,
    private readonly mqtt: MqttService,
    config: ConfigService<Env, true>,
  ) {
    this.prefix = config.get('MQTT_TOPIC_PREFIX', { infer: true });
    this.tolerancePct = config.get('GATE_POSITION_TOLERANCE_PCT', {
      infer: true,
    });
  }

  onModuleInit(): void {
    this.mqtt.register({
      topics: [`${this.prefix}/+/+/${COMMAND_ACK_SUFFIX}`],
      handler: (message) => this.handleMessage(message),
    });
  }

  private async handleMessage(message: MqttMessage): Promise<void> {
    const parsed = parseSeraTopic(this.prefix, message.topic);
    if (parsed === null || parsed.kind !== 'command-ack') {
      return;
    }
    const json = parseJsonPayload(message.payload);
    if (json === null) {
      this.logger.debug(`${INVALID_ACK_MESSAGE} from ${parsed.device}`);
      return;
    }
    const result = commandAckSchema.safeParse(json);
    if (!result.success) {
      this.logger.warn(`${INVALID_ACK_MESSAGE} from ${parsed.device}`);
      return;
    }
    const ack = result.data;
    if (ack.device_id !== parsed.device) {
      this.logger.warn(`${DEVICE_MISMATCH_MESSAGE}: ${parsed.device}`);
      return;
    }
    await this.ingestAck(parsed, ack);
  }

  private async ingestAck(
    parsed: ParsedSeraTopic,
    ack: CommandAck,
  ): Promise<void> {
    const row = await this.prisma.gateCommand.findUnique({
      where: { commandId: ack.command_id },
      select: {
        id: true,
        commandId: true,
        sensorId: true,
        action: true,
        status: true,
        payload: true,
      },
    });
    if (row === null) {
      this.logger.warn(`${UNKNOWN_COMMAND_MESSAGE}: ${ack.command_id}`);
      return;
    }
    const stored = parseStoredPayload(row.payload);
    if (stored === null) {
      this.logger.warn(`${CORRUPT_COMMAND_MESSAGE}: ${ack.command_id}`);
      return;
    }
    if (stored.device_id !== parsed.device) {
      await this.writeEvent({
        type: EVENT_TYPE_SYSTEM,
        severity: SEVERITY_WARNING,
        message: DEVICE_MISMATCH_MESSAGE,
        payload: {
          command_id: ack.command_id,
          expected_device: stored.device_id,
          reported_device: parsed.device,
        },
      });
      return;
    }
    if (row.status !== GATE_COMMAND_STATUS.pending) {
      if (row.status === ack.status) {
        this.logger.debug(`duplicate command ack ignored: ${ack.command_id}`);
        return;
      }
      await this.writeEvent({
        type: EVENT_TYPE_SYSTEM,
        severity: SEVERITY_WARNING,
        message: CONFLICTING_ACK_MESSAGE,
        payload: {
          command_id: ack.command_id,
          stored_status: row.status,
          reported_status: ack.status,
        },
      });
      return;
    }
    const recorded = await this.persistAck(row, ack);
    if (!recorded) {
      this.logger.debug(`command ack lost the claim race: ${ack.command_id}`);
      return;
    }
    await this.reportOutcome(row, ack, stored);
  }

  private async persistAck(
    row: CommandStateRow,
    ack: CommandAck,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const claim = await tx.gateCommand.updateMany({
        where: { id: row.id, status: GATE_COMMAND_STATUS.pending },
        data: { status: ack.status, ackedAt: new Date() },
      });
      if (claim.count !== 1) {
        return false;
      }
      if (
        ack.status === 'accepted' &&
        ack.position_pct !== null &&
        row.sensorId !== null
      ) {
        await tx.gateFeedback.create({
          data: {
            sensorId: row.sensorId,
            commandId: ack.command_id,
            positionPct: ack.position_pct,
            ts: new Date(ack.ts),
            payload: ack as unknown as Prisma.InputJsonValue,
          },
        });
      }
      return true;
    });
  }

  private async reportOutcome(
    row: CommandStateRow,
    ack: CommandAck,
    stored: StoredCommandPayload,
  ): Promise<void> {
    if (ack.status === 'rejected') {
      await this.writeEvent({
        type: EVENT_TYPE_SYSTEM,
        severity: SEVERITY_WARNING,
        message: REJECTED_COMMAND_MESSAGE,
        payload: {
          command_id: ack.command_id,
          device_id: stored.device_id,
          detail: ack.detail,
        },
      });
      return;
    }
    if (ack.status === 'expired') {
      await this.writeEvent({
        type: EVENT_TYPE_SYSTEM,
        severity: SEVERITY_WARNING,
        message: EXPIRED_ON_DEVICE_MESSAGE,
        payload: { command_id: ack.command_id, device_id: stored.device_id },
      });
      return;
    }
    if (ack.position_pct === null || !isCommandAction(row.action)) {
      return;
    }
    const verdict = evaluateGateMismatch(
      row.action,
      ack.position_pct,
      this.tolerancePct,
    );
    if (verdict === null) {
      return;
    }
    const reference = commandReference(ack);
    const message = `${MISMATCH_EVENT_MESSAGE}: ${row.action} commanded, gate reported ${ack.position_pct}%`;
    const eventId = await this.writeEvent({
      type: EVENT_TYPE_ALERT,
      severity: SEVERITY_WARNING,
      message,
      payload: {
        code: GATE_MISMATCH_ALERT_CODE,
        command_id: ack.command_id,
        device_id: stored.device_id,
        action: row.action,
        reported_pct: ack.position_pct,
        expected_pct: verdict.expectedPct,
        deviation_pct: verdict.deviationPct,
        reference,
      },
    });
    if (eventId !== null) {
      this.events.publish({
        type: 'alert.raised',
        network_id: null,
        payload: {
          alert_id: eventId,
          severity: SEVERITY_WARNING,
          code: GATE_MISMATCH_ALERT_CODE,
          message,
          block_id: null,
          plan_id: null,
        },
      });
    }
  }

  private async writeEvent(input: EventInput): Promise<string | null> {
    try {
      const event = await this.prisma.event.create({
        data: {
          networkId: null,
          type: input.type,
          severity: input.severity,
          message: input.message,
          payload: input.payload as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
      return event.id;
    } catch (error) {
      this.logger.warn(`failed to persist command event: ${String(error)}`);
      return null;
    }
  }
}