import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { SortOrder, UserSortField } from '@sera/contracts';
import type { Prisma, UserRole } from '../generated/prisma/client.ts';
import { PrismaService } from '../prisma/prisma.service.ts';
import { AuditContext } from '../common/audit/audit-context.ts';

const USER_NOT_FOUND_MESSAGE = 'User not found';
const SELF_DEACTIVATION_MESSAGE = 'You cannot deactivate your own account';
const LAST_ADMIN_MESSAGE = 'At least one active admin must remain';
const ADMIN_ROLE: UserRole = 'ADMIN';
const UPDATE_AUDIT_ACTION = 'user.update';
const USER_ENTITY = 'User';

const UPDATE_FIELDS = ['fullName', 'role', 'isActive'] as const;

const USER_SELECT = {
  id: true,
  email: true,
  fullName: true,
  role: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

export type UpdateField = (typeof UPDATE_FIELDS)[number];

export interface UserRecord {
  readonly id: string;
  readonly email: string;
  readonly fullName: string;
  readonly role: UserRole;
  readonly isActive: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface UserMembership {
  readonly p3aId: string;
  readonly p3aName: string;
  readonly region: string | null;
  readonly role: string;
}

export interface UserDetailRecord extends UserRecord {
  readonly memberships: readonly UserMembership[];
}

export interface UserPage {
  readonly items: readonly UserRecord[];
  readonly total: number;
}

export interface UserListQuery {
  readonly search?: string;
  readonly role?: UserRole;
  readonly isActive?: boolean;
  readonly page: number;
  readonly limit: number;
  readonly sort: UserSortField;
  readonly order: SortOrder;
}

export interface UserUpdateChanges {
  readonly fullName?: string;
  readonly role?: UserRole;
  readonly isActive?: boolean;
}

interface MembershipRow {
  readonly role: string;
  readonly p3a: {
    readonly id: string;
    readonly name: string;
    readonly region: string | null;
  };
}

type UserRow = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;

const SORT_ORDER_BUILDERS: Readonly<
  Record<
    UserSortField,
    (order: SortOrder) => Prisma.UserOrderByWithRelationInput
  >
> = {
  created_at: (order) => ({ createdAt: order }),
  full_name: (order) => ({ fullName: order }),
  email: (order) => ({ email: order }),
};

function toUserRecord(row: UserRow): UserRecord {
  return {
    id: row.id,
    email: row.email,
    fullName: row.fullName,
    role: row.role,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toUserMembership(row: MembershipRow): UserMembership {
  return {
    p3aId: row.p3a.id,
    p3aName: row.p3a.name,
    region: row.p3a.region,
    role: row.role,
  };
}

function buildUserWhere(query: UserListQuery): Prisma.UserWhereInput {
  const search = query.search;
  return {
    ...(query.role === undefined ? {} : { role: query.role }),
    ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
    ...(search === undefined
      ? {}
      : {
          OR: [
            { email: { contains: search, mode: 'insensitive' } },
            { fullName: { contains: search, mode: 'insensitive' } },
          ],
        }),
  };
}

function buildUserOrderBy(
  sort: UserSortField,
  order: SortOrder,
): Prisma.UserOrderByWithRelationInput[] {
  return [SORT_ORDER_BUILDERS[sort](order), { id: 'asc' }];
}

function resolveNextState(
  current: UserRecord,
  changes: UserUpdateChanges,
): UserRecord {
  return {
    ...current,
    fullName: changes.fullName ?? current.fullName,
    role: changes.role ?? current.role,
    isActive: changes.isActive ?? current.isActive,
  };
}

function collectChangedFields(
  current: UserRecord,
  next: UserRecord,
): UpdateField[] {
  return UPDATE_FIELDS.filter((field) => current[field] !== next[field]);
}

function buildUpdateData(
  next: UserRecord,
  changed: readonly UpdateField[],
): Prisma.UserUpdateInput {
  return {
    ...(changed.includes('fullName') ? { fullName: next.fullName } : {}),
    ...(changed.includes('role') ? { role: next.role } : {}),
    ...(changed.includes('isActive') ? { isActive: next.isActive } : {}),
  };
}

function buildAuditDiff(
  current: UserRecord,
  next: UserRecord,
  changed: readonly UpdateField[],
) {
  return {
    before: Object.fromEntries(
      changed.map((field) => [field, current[field]] as const),
    ),
    after: Object.fromEntries(
      changed.map((field) => [field, next[field]] as const),
    ),
  };
}

function losesAdminRights(current: UserRecord, next: UserRecord): boolean {
  return (
    current.role === ADMIN_ROLE &&
    current.isActive &&
    (next.role !== ADMIN_ROLE || !next.isActive)
  );
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: UserListQuery): Promise<UserPage> {
    const where = buildUserWhere(query);
    const orderBy = buildUserOrderBy(query.sort, query.order);
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: USER_SELECT,
      }),
    ]);
    return { items: rows.map(toUserRecord), total };
  }

  async getById(id: string): Promise<UserDetailRecord> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        ...USER_SELECT,
        memberships: {
          select: {
            role: true,
            p3a: { select: { id: true, name: true, region: true } },
          },
        },
      },
    });
    if (user === null) {
      throw new NotFoundException(USER_NOT_FOUND_MESSAGE);
    }
    return {
      ...toUserRecord(user),
      memberships: user.memberships.map(toUserMembership),
    };
  }

  async update(
    actorId: string,
    targetId: string,
    changes: UserUpdateChanges,
    context: AuditContext,
  ): Promise<UserRecord> {
    const current = await this.findRecordOrThrow(targetId);
    const next = resolveNextState(current, changes);
    const changed = collectChangedFields(current, next);
    if (changed.length === 0) {
      return current;
    }
    if (!next.isActive && actorId === targetId) {
      throw new ConflictException(SELF_DEACTIVATION_MESSAGE);
    }
    const removesAdminRights = losesAdminRights(current, next);
    const data = buildUpdateData(next, changed);
    const diff = buildAuditDiff(current, next, changed);
    return this.prisma.$transaction(
      async (tx) => {
        if (removesAdminRights) {
          const remainingAdmins = await tx.user.count({
            where: {
              role: ADMIN_ROLE,
              isActive: true,
              id: { not: targetId },
            },
          });
          if (remainingAdmins === 0) {
            throw new ConflictException(LAST_ADMIN_MESSAGE);
          }
        }
        const updated = await tx.user.update({
          where: { id: targetId },
          data,
          select: USER_SELECT,
        });
        await tx.auditLog.create({
          data: {
            userId: actorId,
            action: UPDATE_AUDIT_ACTION,
            entity: USER_ENTITY,
            entityId: targetId,
            before: diff.before,
            after: diff.after,
            ip: context.ip,
            userAgent: context.userAgent,
          },
        });
        return toUserRecord(updated);
      },
      { isolationLevel: 'Serializable' },
    );
  }

  private async findRecordOrThrow(id: string): Promise<UserRecord> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: USER_SELECT,
    });
    if (user === null) {
      throw new NotFoundException(USER_NOT_FOUND_MESSAGE);
    }
    return toUserRecord(user);
  }
}
