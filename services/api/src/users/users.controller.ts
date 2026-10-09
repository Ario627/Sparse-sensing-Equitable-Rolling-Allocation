import type { Request } from 'express';
import type { AuthenticatedUser } from '../auth/access-token.ts';
import { CurrentUser, Roles } from '../auth/auth.decorators.ts';
import { auditContextFrom } from '../common/audit/audit-context.ts';
import {
  UsersService,
  type UserDetailRecord,
  type UserRecord,
  type UserUpdateChanges,
} from './users.service.ts';
import {
  listUsersQuerySchema,
  updateUserRequestSchema,
  userIdSchema,
  createUserRequestSchema,
  type CreateUserRequest,
  type ListUsersQuery,
  type UpdateUserRequest,
  type UserDetailResponse,
  type UserSummary,
  type UsersListResponse,
} from '@sera/contracts';
import {
  Post,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  Req,
} from '@nestjs/common';
import { UserCreateService } from './users.create.service.ts';

const ADMIN_ROLE = 'ADMIN' as const;

function toUserSummary(record: UserRecord): UserSummary {
  return {
    id: record.id,
    email: record.email,
    full_name: record.fullName,
    role: record.role,
    is_active: record.isActive,
    created_at: record.createdAt.toISOString(),
    updated_at: record.updatedAt.toISOString(),
  };
}

function toUserDetail(record: UserDetailRecord): UserDetailResponse {
  return {
    ...toUserSummary(record),
    memberships: record.memberships.map((membership) => ({
      p3a_id: membership.p3aId,
      p3a_name: membership.p3aName,
      region: membership.region,
      role: membership.role,
    })),
  };
}

function toUpdateChanges(body: UpdateUserRequest): UserUpdateChanges {
  return {
    ...(body.full_name === undefined ? {} : { fullName: body.full_name }),
    ...(body.role === undefined ? {} : { role: body.role }),
    ...(body.is_active === undefined ? {} : { isActive: body.is_active }),
  };
}

@Controller('users')
@Roles(ADMIN_ROLE)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly createService: UserCreateService,
  ) {}

  @Get()
  async list(
    @Query({ schema: listUsersQuerySchema }) query: ListUsersQuery,
  ): Promise<UsersListResponse> {
    const page = await this.usersService.list({
      search: query.q,
      role: query.role,
      isActive: query.is_active,
      page: query.page,
      limit: query.limit,
      sort: query.sort,
      order: query.order,
    });
    return {
      items: page.items.map(toUserSummary),
      page: query.page,
      limit: query.limit,
      total: page.total,
      total_pages: Math.max(1, Math.ceil(page.total / query.limit)),
    };
  }

  @Post()
  async create(
    @Body({ schema: createUserRequestSchema }) body: CreateUserRequest,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<UserSummary> {
    const created = await this.createService.create(
      actor.id,
      {
        email: body.email,
        fullName: body.full_name,
        role: body.role,
        initialPassword: body.initial_password,
      },
      auditContextFrom(request),
    );
    return toUserSummary(created);
  }

  @Get(':id')
  async detail(
    @Param('id', { schema: userIdSchema }) id: string,
  ): Promise<UserDetailResponse> {
    return toUserDetail(await this.usersService.getById(id));
  }

  @Patch(':id')
  async update(
    @Param('id', { schema: userIdSchema }) id: string,
    @Body({ schema: updateUserRequestSchema }) body: UpdateUserRequest,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<UserSummary> {
    const record = await this.usersService.update(
      actor.id,
      id,
      toUpdateChanges(body),
      auditContextFrom(request),
    );
    return toUserSummary(record);
  }
}
