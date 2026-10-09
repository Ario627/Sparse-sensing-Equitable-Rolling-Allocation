import { ConflictException, Injectable } from '@nestjs/common';
import type { AuditContext } from '../common/audit/audit-context.ts';
import type { UserRole } from '../generated/prisma/client.ts';
import { Prisma } from '../generated/prisma/client.ts';
import { PrismaService } from '../prisma/prisma.service.ts';
import { USER_EMAIL_TAKEN_MESSAGE } from './users.constant.ts';
import type { UserCreateRequest } from './users.create-password.util.ts';
import type { UserRecord } from './users.service.ts';
import { Argon2PasswordService } from './users.password.service.ts';

export type { UserCreateRequest };



function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}


function toUserRecord(user: {
  readonly id: string;
  readonly email: string;
  readonly fullName: string;
  readonly role: UserRole;
  readonly isActive: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}): UserRecord {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    isActive: user.isActive,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

@Injectable()
export class UserCreateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: Argon2PasswordService,
  ) {}

  async create(
    actorId: string,
    input: UserCreateRequest,
    audit: AuditContext,
  ): Promise<UserRecord> {
    const email = input.email.toLowerCase();
    const passwordHash = await this.passwords.hash(input.initialPassword);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email,
            fullName: input.fullName,
            role: input.role,
            passwordHash,
          },
          select: {
            id: true,
            email: true,
            fullName: true,
            role: true,
            isActive: true,
            createdAt: true,
            updatedAt: true,
          },
        });
        await tx.auditLog.create({
          data: {
            userId: actorId,
            action: 'user.create',
            entity: 'User',
            entityId: user.id,
            after: { email, full_name: input.fullName, role: input.role },
            ip: audit.ip,
            userAgent: audit.userAgent,
          },
        });
        return toUserRecord(user);
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(USER_EMAIL_TAKEN_MESSAGE);
      }
      throw error;
    }
  }
}
