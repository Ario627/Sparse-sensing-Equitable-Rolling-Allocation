import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  auditLogIdSchema,
  listAuditQuerySchema,
  type AuditListResponse,
  type AuditLogResponse,
  type ListAuditQuery,
} from '@sera/contracts';
import { Roles } from '../auth/auth.decorators.ts';
import { AuditService } from './audit.service.ts';
import type { AuditLogRecord } from './audit.types.ts';

const ADMIN_ROLE = 'ADMIN' as const;

function toAuditResponse(record: AuditLogRecord): AuditLogResponse {
  return {
    id: record.id,
    actor:
      record.actor === null
        ? null
        : {
            id: record.actor.id,
            full_name: record.actor.fullName,
            email: record.actor.email,
          },
    action: record.action,
    entity: record.entity,
    entity_id: record.entityId,
    before: record.before,
    after: record.after,
    ip: record.ip,
    user_agent: record.userAgent,
    created_at: record.createdAt.toISOString(),
  };
}

@Controller('audit')
@Roles(ADMIN_ROLE)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  async list(
    @Query({ schema: listAuditQuerySchema }) query: ListAuditQuery,
  ): Promise<AuditListResponse> {
    const page = await this.auditService.list({
      ...(query.action === undefined ? {} : { action: query.action }),
      ...(query.entity === undefined ? {} : { entity: query.entity }),
      ...(query.entity_id === undefined ? {} : { entityId: query.entity_id }),
      ...(query.user_id === undefined ? {} : { userId: query.user_id }),
      ...(query.q === undefined ? {} : { search: query.q }),
      ...(query.from === undefined ? {} : { from: new Date(query.from) }),
      ...(query.to === undefined ? {} : { to: new Date(query.to) }),
      page: query.page,
      limit: query.limit,
      order: query.order,
    });
    return {
      items: page.items.map(toAuditResponse),
      page: query.page,
      limit: query.limit,
      total: page.total,
      total_pages: Math.max(1, Math.ceil(page.total / query.limit)),
    };
  }

  @Get(':id')
  async detail(
    @Param('id', { schema: auditLogIdSchema }) id: string,
  ): Promise<AuditLogResponse> {
    return toAuditResponse(await this.auditService.getById(id));
  }
}
