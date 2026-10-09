import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Command } from '@sera/contracts';
import type { AuditContext } from '../common/audit/audit-context.ts';
import { DomainEventBus } from '../common/events/domain-event-bus.service.ts';
import type { Env } from '../common/config/env.ts';
import type { Prisma, SensorType } from '../generated/prisma/client.ts';
import { MqttService } from '../mqtt/mqtt.service.ts';
import { buildCommandTopic } from '../mqtt/mqtt.topic.ts';
import { PrismaService } from '../prisma/prisma.service.ts';
import {
  AUDIT_ENTITY,
  EVENT_TYPE_SYSTEM,
  EXECUTE_AUDIT_ACTION,
  PLAN_MESSAGES,
  SEVERITY_WARNING,
} from './plans.constants.ts';

interface OperativeItem {
  readonly id: string;
  readonly blockId: string;
  readonly blockName: string;
  readonly gateOpen: boolean;
}

interface ExecutionRoute {
  readonly item: OperativeItem;
  readonly deviceId: string;
  readonly sensorId: string | null;
  readonly gateNodeId: string;
}

interface PreparedCommand {
  readonly commandId: string;
  readonly planItemId: string;
  readonly sensorId: string | null;
  readonly deviceId: string;
  readonly action: string;
  readonly wire: Command;
}

interface PreparedExecution {
  readonly networkId: string;
  readonly slotStart: Date;
  readonly commands: readonly PreparedCommand[];
}

@Injectable()
export class PlanExecutionService {
  private readonly logger = new Logger(PlanExecutionService.name);
  private readonly topicPrefix: string;
  private readonly siteId: string;
  private readonly commandTtlS: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mqtt: MqttService,
    private readonly events: DomainEventBus,
    config: ConfigService<Env, true>,
  ) {
    this.topicPrefix = config.get('MQTT_TOPIC_PREFIX', { infer: true });
    this.siteId = config.get('MQTT_SITE_ID', { infer: true });
    this.commandTtlS = config.get('COMMAND_TTL_S', { infer: true });
  }

  async execute(
    actorId: string,
    planId: string,
    audit: AuditContext,
  ): Promise<void> {
    const now = new Date();
    const prepared = await this.prisma.$transaction(
      async (tx): Promise<PreparedExecution> => {
      const plan = await tx.plan.findUnique({
        where: { id: planId },
        select: { id: true, status: true, networkId: true },
      });
      if (plan === null) {
        throw new NotFoundException(PLAN_MESSAGES.planNotFound);
      }
      if (plan.status !== 'APPROVED') {
        throw new ConflictException(PLAN_MESSAGES.executeStatus);
      }
      const items = await tx.planItem.findMany({
        where: { planId },
        select: {
          id: true,
          blockId: true,
          slotStart: true,
          slotEnd: true,
          gateOpen: true,
          block: { select: { name: true } },
        },
        orderBy: [{ slotStart: 'asc' }, { blockId: 'asc' }],
      });
      const future = items.filter(
        (item) => item.slotEnd.getTime() > now.getTime(),
      );
      const first = future[0];
      if (first === undefined) {
        throw new ConflictException(PLAN_MESSAGES.slotsPassed);
      }
      const slotStartMs = first.slotStart.getTime();
      const operative: OperativeItem[] = future
        .filter((item) => item.slotStart.getTime() === slotStartMs)
        .map((item) => ({
          id: item.id,
          blockId: item.blockId,
          blockName: item.block.name,
          gateOpen: item.gateOpen,
        }));
      const routes = await this.resolveRoutes(tx, plan.networkId, operative);
      const expiresAt = new Date(now.getTime() + this.commandTtlS * 1_000);
      const commands: PreparedCommand[] = routes.map((route) => {
        const commandId = randomUUID();
        const wire: Command = {
          schema_version: 1,
          command_id: commandId,
          ts: now.toISOString(),
          action: route.item.gateOpen ? 'open' : 'close',
          target: route.gateNodeId,
          expires_at: expiresAt.toISOString(),
          reason: `plan:${planId} item:${route.item.id}`,
        };
        return {
          commandId,
          planItemId: route.item.id,
          sensorId: route.sensorId,
          deviceId: route.deviceId,
          action: wire.action,
          wire,
        };
      });
      await tx.gateCommand.createMany({
        data: commands.map((command) => ({
          commandId: command.commandId,
          planItemId: command.planItemId,
          sensorId: command.sensorId,
          action: command.action,
          payload: {
            device_id: command.deviceId,
            command: command.wire,
          } as unknown as Prisma.InputJsonValue,
          status: 'pending',
        })),
      });
      await tx.plan.update({
        where: { id: planId },
        data: { status: 'EXECUTED' },
      });
      await tx.plan.updateMany({
        where: {
          networkId: plan.networkId,
          status: 'APPROVED',
          id: { not: planId },
        },
        data: { status: 'SUPERSEDED' },
      });
      await tx.auditLog.create({
        data: {
          userId: actorId,
          action: EXECUTE_AUDIT_ACTION,
          entity: AUDIT_ENTITY,
          entityId: planId,
          after: {
            slot_start: first.slotStart.toISOString(),
            commands: commands.length,
          },
          ip: audit.ip,
          userAgent: audit.userAgent,
        },
      });
      return {
        networkId: plan.networkId,
        slotStart: first.slotStart,
        commands,
      };
    });
    let failed = 0;
    for (const command of prepared.commands) {
      const published = await this.mqtt.publish(
        buildCommandTopic(this.topicPrefix, this.siteId, command.deviceId),
        JSON.stringify(command.wire),
      );
      if (!published) {
        failed += 1;
      }
    }
    if (failed > 0) {
      await this.recordDispatchFailure(
        prepared.networkId,
        planId,
        prepared.slotStart,
        prepared.commands.length,
        failed,
      );
    }
    this.events.publish({
      type: 'plan.executed',
      network_id: prepared.networkId,
      payload: {
        plan_id: planId,
        status: 'EXECUTED',
        dispatched_slot_start: prepared.slotStart.toISOString(),
        command_count: prepared.commands.length,
      },
    });
  }

  private async resolveRoutes(
    tx: Prisma.TransactionClient,
    networkId: string,
    items: readonly OperativeItem[],
  ): Promise<ExecutionRoute[]> {
    const [nodes, edges, blocks, sensors] = await Promise.all([
      tx.node.findMany({
        where: { networkId },
        select: { id: true, type: true },
      }),
      tx.edge.findMany({
        where: { networkId },
        select: { fromNodeId: true, toNodeId: true },
      }),
      tx.block.findMany({
        where: { networkId },
        select: { id: true, nodeId: true },
      }),
      tx.sensor.findMany({
        where: { networkId, isActive: true },
        select: { id: true, nodeId: true, deviceId: true, type: true },
      }),
    ]);
    const nodeTypeById = new Map(nodes.map((node) => [node.id, node.type]));
    const predecessorByNode = new Map(
      edges.map((edge) => [edge.toNodeId, edge.fromNodeId]),
    );
    const blockNodeById = new Map(
      blocks.map((block) => [block.id, block.nodeId]),
    );
    const sensorsByNode = new Map<
      string,
      { id: string; deviceId: string; type: SensorType }[]
    >();
    for (const sensor of sensors) {
      if (sensor.nodeId === null) {
        continue;
      }
      const list = sensorsByNode.get(sensor.nodeId);
      if (list === undefined) {
        sensorsByNode.set(sensor.nodeId, [sensor]);
      } else {
        list.push(sensor);
      }
    }
    const devices = [...new Set(sensors.map((sensor) => sensor.deviceId))];
    if (devices.length === 0) {
      throw new ConflictException(PLAN_MESSAGES.noDevice);
    }
    const singleDevice = devices.length === 1 ? devices[0] : undefined;
    const routes: ExecutionRoute[] = [];
    const unresolved: string[] = [];
    for (const item of items) {
      const blockNodeId = blockNodeById.get(item.blockId);
      if (blockNodeId === undefined) {
        unresolved.push(item.blockName);
        continue;
      }
      const predecessorId = predecessorByNode.get(blockNodeId);
      const gateNodeId =
        predecessorId !== undefined &&
        nodeTypeById.get(predecessorId) === 'GATE'
          ? predecessorId
          : blockNodeId;
      const nodeSensors = sensorsByNode.get(gateNodeId) ?? [];
      const preferred =
        nodeSensors.find((sensor) => sensor.type === 'GATE_POSITION') ??
        nodeSensors[0];
      const deviceId = preferred?.deviceId ?? singleDevice;
      if (deviceId === undefined) {
        unresolved.push(item.blockName);
        continue;
      }
      routes.push({
        item,
        deviceId,
        sensorId: preferred?.id ?? null,
        gateNodeId,
      });
    }
    if (unresolved.length > 0) {
      throw new ConflictException({
        message: PLAN_MESSAGES.noRoute,
        blocks: unresolved,
      });
    }
    return routes;
  }

  

  private async recordDispatchFailure(
    networkId: string,
    planId: string,
    slotStart: Date,
    total: number,
    failed: number,
  ): Promise<void> {
    try {
      await this.prisma.event.create({
        data: {
          networkId,
          type: EVENT_TYPE_SYSTEM,
          severity: SEVERITY_WARNING,
          message: `gate command publish failed (${failed}/${total})`,
          payload: {
            plan_id: planId,
            slot_start: slotStart.toISOString(),
            failed,
            total,
          },
        },
      });
    } catch (error) {
      this.logger.warn(`failed to persist dispatch failure: ${String(error)}`);
    }
  }
}
