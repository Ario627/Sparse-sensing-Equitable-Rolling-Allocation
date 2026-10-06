import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../common/config/env.ts";
import type { Prisma } from "../generated/prisma/client.ts";
import { MqttService } from "../mqtt/mqtt.service.ts";
import { buildCommandTopic } from "../mqtt/mqtt.topic.ts";
import { PrismaService } from "../prisma/prisma.service.ts";
import { isCommandExpired, parseStoredPayload } from "./commands.payload.ts";
import {
  COMMAND_SWEEP_BATCH,
  COMMAND_SWEEP_INTERVAL_MS,
  CORRUPT_COMMAND_MESSAGE,
  EVENT_TYPE_SYSTEM,
  EXPIRED_NO_ACK_MESSAGE,
  GATE_COMMAND_STATUS,
  SEVERITY_WARNING,
} from './commands.constants.ts';

@Injectable()
export class CommandRetryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CommandRetryService.name);
  private readonly prefix: string;
  private readonly siteId: string;
  private readonly ackTimeoutMs: number;
  private readonly maxAttempts: number;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mqtt: MqttService,
    config: ConfigService<Env, true>,
  ) {
    this.prefix = config.get('MQTT_TOPIC_PREFIX', { infer: true });
    this.siteId = config.get('MQTT_SITE_ID', { infer: true });
    this.ackTimeoutMs =
      config.get('COMMAND_ACK_TIMEOUT_S', { infer: true }) * 1_000;
    this.maxAttempts = config.get('COMMAND_MAX_ATTEMPTS', { infer: true });
  }

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.sweep();
    }, COMMAND_SWEEP_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private async sweep(): Promise<void> {
    const now = new Date();
    const staleBefore = new Date(now.getTime() - this.ackTimeoutMs);
    const candidates = await this.prisma.gateCommand.findMany({
      where: {
        status: GATE_COMMAND_STATUS.pending,
        OR: [
          { lastAttemptAt: { lt: staleBefore } },
          { lastAttemptAt: null, issuedAt: { lt: staleBefore } },
        ],
      },
      orderBy: { issuedAt: 'asc' },
      take: COMMAND_SWEEP_BATCH,
      select: {
        id: true,
        commandId: true,
        attempts: true,
        payload: true,
      },
    });
    for (const row of candidates) {
      const stored = parseStoredPayload(row.payload);
      if (stored === null) {
        await this.markUnanswered(row.id, row.commandId, null);
        continue;
      }
      if (isCommandExpired(stored.command, now)) {
        await this.markUnanswered(row.id, row.commandId, stored.device_id);
        continue;
      }
      if (row.attempts >= this.maxAttempts) {
        continue;
      }
      await this.resend(
        row.id,
        row.commandId,
        row.attempts,
        stored.device_id,
        stored.command,
      );
    }
  }

  private async resend(
    id: string,
    commandId: string,
    attempts: number,
    deviceId: string,
    command: unknown,
  ): Promise<void> {
    const claim = await this.prisma.gateCommand.updateMany({
      where: { id, status: GATE_COMMAND_STATUS.pending, attempts },
      data: { attempts: { increment: 1 }, lastAttemptAt: new Date() },
    });
    if (claim.count !== 1) {
      return;
    }
    const published = await this.mqtt.publish(
      buildCommandTopic(this.prefix, this.siteId, deviceId),
      JSON.stringify(command),
    );
    this.logger.debug(
      `gate command re-send ${published ? 'ok' : 'failed'}: ${commandId}`,
    );
  }

  private async markUnanswered(
    id: string,
    commandId: string,
    deviceId: string | null,
  ): Promise<void> {
    const claim = await this.prisma.gateCommand.updateMany({
      where: { id, status: GATE_COMMAND_STATUS.pending },
      data: { status: GATE_COMMAND_STATUS.unanswered },
    });
    if (claim.count !== 1) {
      return;
    }
    await this.writeEvent({
      commandId,
      deviceId,
      message:
        deviceId === null ? CORRUPT_COMMAND_MESSAGE : EXPIRED_NO_ACK_MESSAGE,
    });
  }

  private async writeEvent(input: {
    readonly commandId: string;
    readonly deviceId: string | null;
    readonly message: string;
  }): Promise<void> {
    try {
      await this.prisma.event.create({
        data: {
          networkId: null,
          type: EVENT_TYPE_SYSTEM,
          severity: SEVERITY_WARNING,
          message: input.message,
          payload: {
            command_id: input.commandId,
            device_id: input.deviceId,
          } as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      this.logger.warn(`failed to persist command event: ${String(error)}`);
    }
  }
}