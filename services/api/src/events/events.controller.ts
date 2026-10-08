import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  eventIdSchema,
  listEventsQuerySchema,
  type EventResponse,
  type EventsListResponse,
  type EventsStatsResponse,
  type ListEventsQuery,
} from '@sera/contracts';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../auth/access-token.ts';
import { CurrentUser, Roles } from '../auth/auth.decorators.ts';
import { auditContextFrom } from '../common/audit/audit-context.ts';
import { EventsService } from './events.service.ts';
import type { EventRecord } from './events.types.ts';

const READ_ROLES = ['OPERATOR', 'RESEARCHER'] as const;
const ACKNOWLEDGE_ROLE = 'OPERATOR' as const;
const ACKNOWLEDGE_RATE_LIMIT = { default: { limit: 60, ttl: 60_000 } };

function toEventResponse(record: EventRecord): EventResponse {
  return {
    id: record.id,
    type: record.type,
    severity: record.severity,
    message: record.message,
    network_id: record.networkId,
    plan_id: record.planId,
    payload: record.payload,
    acknowledged_at:
      record.acknowledgedAt === null
        ? null
        : record.acknowledgedAt.toISOString(),
    acknowledged_by:
      record.acknowledgedBy === null
        ? null
        : {
            id: record.acknowledgedBy.id,
            full_name: record.acknowledgedBy.fullName,
          },
    created_at: record.createdAt.toISOString(),
  };
}

@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Roles(...READ_ROLES)
  @Get()
  async list(
    @Query({ schema: listEventsQuerySchema }) query: ListEventsQuery,
  ): Promise<EventsListResponse> {
    const page = await this.eventsService.list({
      ...(query.type === undefined ? {} : { type: query.type }),
      ...(query.severity === undefined ? {} : { severity: query.severity }),
      ...(query.code === undefined ? {} : { code: query.code }),
      ...(query.acknowledged === undefined
        ? {}
        : { acknowledged: query.acknowledged }),
      ...(query.network_id === undefined
        ? {}
        : { networkId: query.network_id }),
      ...(query.plan_id === undefined ? {} : { planId: query.plan_id }),
      ...(query.q === undefined ? {} : { search: query.q }),
      ...(query.from === undefined ? {} : { from: new Date(query.from) }),
      ...(query.to === undefined ? {} : { to: new Date(query.to) }),
      page: query.page,
      limit: query.limit,
      order: query.order,
    });
    return {
      items: page.items.map(toEventResponse),
      page: query.page,
      limit: query.limit,
      total: page.total,
      total_pages: Math.max(1, Math.ceil(page.total / query.limit)),
    };
  }

  @Roles(...READ_ROLES)
  @Get('stats')
  async stats(): Promise<EventsStatsResponse> {
    const stats = await this.eventsService.stats();
    return {
      unacknowledged: stats.unacknowledged,
      by_severity: stats.bySeverity,
    };
  }

  @Roles(...READ_ROLES)
  @Get(':id')
  async detail(
    @Param('id', { schema: eventIdSchema }) id: string,
  ): Promise<EventResponse> {
    return toEventResponse(await this.eventsService.getById(id));
  }

  @Roles(ACKNOWLEDGE_ROLE)
  @Post(':id/acknowledge')
  @Throttle(ACKNOWLEDGE_RATE_LIMIT)
  @HttpCode(HttpStatus.OK)
  async acknowledge(
    @Param('id', { schema: eventIdSchema }) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<EventResponse> {
    const event = await this.eventsService.acknowledge(
      actor.id,
      id,
      auditContextFrom(request),
    );
    return toEventResponse(event);
  }
}
