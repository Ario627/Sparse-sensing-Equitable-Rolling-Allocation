import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import {
  createP3aRequestSchema,
  p3aIdSchema,
  updateP3aRequestSchema,
  type CreateP3aRequest,
  type P3aListResponse,
  type P3aSummaryResponse,
  type UpdateP3aRequest,
} from '@sera/contracts';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../auth/access-token.ts';
import { CurrentUser, Roles } from '../auth/auth.decorators.ts';
import { auditContextFrom } from '../common/audit/audit-context.ts';
import { P3aService, type P3aRecord } from './p3a.service.ts';

const ADMIN_ROLE = 'ADMIN' as const;

function toP3aResponse(record: P3aRecord): P3aSummaryResponse {
  return {
    id: record.id,
    name: record.name,
    region: record.region,
    member_count: record.memberCount,
    created_at: record.createdAt.toISOString(),
  };
}


@Controller('p3a')
@Roles(ADMIN_ROLE)
export class P3aController {
  constructor(private readonly p3aService: P3aService) {}

  @Get()
  async list(): Promise<P3aListResponse> {
    const organizations = await this.p3aService.listOrganizations();
    return { items: organizations.map(toP3aResponse) };
  }

  @Post()
  async create(
    @Body({ schema: createP3aRequestSchema }) body: CreateP3aRequest,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<P3aSummaryResponse> {
    const created = await this.p3aService.create(
      actor.id,
      { name: body.name, region: body.region },
      auditContextFrom(request),
    );
    return toP3aResponse(created);
  }

  @Patch(':id')
  async update(
    @Param('id', { schema: p3aIdSchema }) id: string,
    @Body({ schema: updateP3aRequestSchema }) body: UpdateP3aRequest,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<P3aSummaryResponse> {
    const updated = await this.p3aService.update(
      actor.id,
      id,
      {
        ...(body.name === undefined ? {} : { name: body.name }),
        ...(body.region === undefined ? {} : { region: body.region }),
      },
      auditContextFrom(request),
    );
    return toP3aResponse(updated);
  }
}