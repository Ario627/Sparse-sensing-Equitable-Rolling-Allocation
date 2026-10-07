import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Put,
} from '@nestjs/common';
import {
  resetPasswordRequestSchema,
  userIdSchema,
  type ResetPasswordRequest,
} from '@sera/contracts';
import { Roles } from '../auth/auth.decorators.ts';
import { PrismaService } from '../prisma/prisma.service.ts';
import { Argon2PasswordService } from './users.password.service.ts';
import {
  PASSWORD_RESET_AUDIT_ACTION,
  USER_NOT_FOUND_MESSAGE,
} from './users.constant.ts';

const ADMIN_ROLE = 'ADMIN' as const;

@Controller('users')
@Roles(ADMIN_ROLE)
export class UsersPasswordController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: Argon2PasswordService,
  ) {}

  @Put(':id/password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async reset(
    @Param('id', { schema: userIdSchema }) id: string,
    @Body({ schema: resetPasswordRequestSchema })
    body: ResetPasswordRequest,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, passwordHash: true },
    });
    if (user === null) {
      throw new NotFoundException(USER_NOT_FOUND_MESSAGE);
    }
    const samePassword = await this.passwords.verify(
      user.passwordHash,
      body.new_password,
    );
    if (samePassword) {
      throw new BadRequestException(
        'New password must differ from the current password',
      );
    }
    const passwordHash = await this.passwords.hash(body.new_password);
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.updateMany({
        where: { id },
        data: { passwordHash },
      });
      if (updated.count !== 1) {
        throw new NotFoundException(USER_NOT_FOUND_MESSAGE);
      }
      await tx.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          userId: null,
          action: PASSWORD_RESET_AUDIT_ACTION,
          entity: 'User',
          entityId: id,
          after: { sessions_revoked: true },
        },
      });
    });
  }
}
