import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Put,
  Req,
} from '@nestjs/common';
import {
  p3aIdSchema,
  upsertMembershipRequestSchema,
  userIdSchema,
  type UpsertMembershipRequest,
  type UserMembership,
} from '@sera/contracts';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../auth/access-token.ts';
import { CurrentUser, Roles } from '../auth/auth.decorators.ts';
import { auditContextFrom } from '../common/audit/audit-context.ts';
import {
  UsersMembershipsService,
  type MembershipRecord,
} from './users.memberships.service.ts';

const ADMIN_ROLE = 'ADMIN' as const;

function toMembershipResponse(record: MembershipRecord): UserMembership {
  return {
    p3a_id: record.p3aId,
    p3a_name: record.p3aName,
    region: record.region,
    role: record.role,
  };
}

@Controller('users')
@Roles(ADMIN_ROLE)
export class UsersMembershipsController {
  constructor(private readonly memberships: UsersMembershipsService) {}

  @Put(':userId/memberships/:p3aId')
  async assign(
    @Param('userId', { schema: userIdSchema }) userId: string,
    @Param('p3aId', { schema: p3aIdSchema }) p3aId: string,
    @Body({ schema: upsertMembershipRequestSchema })
    body: UpsertMembershipRequest,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<UserMembership> {
    return toMembershipResponse(
      await this.memberships.assign(
        actor.id,
        userId,
        p3aId,
        body.role,
        auditContextFrom(request),
      ),
    );
  }

  @Delete(':userId/memberships/:p3aId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('userId', { schema: userIdSchema }) userId: string,
    @Param('p3aId', { schema: p3aIdSchema }) p3aId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<void> {
    await this.memberships.remove(
      actor.id,
      userId,
      p3aId,
      auditContextFrom(request),
    );
  }
}
