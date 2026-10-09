import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Env } from '../common/config/env.ts';
import type { UserRole } from '../generated/prisma/client.ts';
import { PrismaService } from '../prisma/prisma.service.ts';
import { Argon2PasswordService } from '../users/users.password.service.ts';
export const AUTH_ISSUER = 'sera-api';
export const AUTH_AUDIENCE = 'sera-web';

const REFRESH_TOKEN_BYTES = 32;
const INVALID_CREDENTIALS_MESSAGE = 'Invalid credentials';
const INVALID_REFRESH_MESSAGE = 'Invalid refresh token';
const EXPIRED_REFRESH_MESSAGE = 'Refresh token expired';
const REUSE_DETECTED_MESSAGE = 'Refresh token reuse detected';
const INACTIVE_ACCOUNT_MESSAGE = 'Account is not active';
const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,p=1,t=2$3J2LU/B3fdehZJfu1muCgw$QPab3dkm8p5ZH+z1RgrLlK+VyLggeNTCvzRFyb13jU0';

const WRONG_PASSWORD_MESSAGE = 'Current password is incorrect';

export interface SessionUser {
  readonly id: string;
  readonly email: string;
  readonly fullName: string;
  readonly role: UserRole;
}

export interface SessionTokens {
  readonly accessToken: string;
  readonly accessExpiresInS: number;
  readonly refreshToken: string;
  readonly refreshExpiresAt: Date;
}

export interface AuthenticatedSession {
  readonly user: SessionUser;
  readonly tokens: SessionTokens;
}

function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function generateRefreshToken(): string {
  return randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
}



@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
    private readonly argon2password: Argon2PasswordService,
  ) {}

  private async signAccessToken(
    user: SessionUser,
  ): Promise<{ token: string; expiresInS: number }> {
    const token = await this.jwt.signAsync({ sub: user.id, role: user.role });
    return {
      token,
      expiresInS: this.config.get('JWT_ACCESS_TTL', { infer: true }),
    };
  }

  private buildRefreshToken(): {
    token: string;
    tokenHash: string;
    expiresAt: Date;
  } {
    const token = generateRefreshToken();
    const ttlS = this.config.get('JWT_REFRESH_TTL', { infer: true });
    return {
      token,
      tokenHash: hashRefreshToken(token),
      expiresAt: new Date(Date.now() + ttlS * 1_000),
    };
  }

  private async issueSession(
    user: SessionUser,
    familyId: string,
  ): Promise<SessionTokens> {
    const refresh = this.buildRefreshToken();
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: refresh.tokenHash,
        familyId,
        expiresAt: refresh.expiresAt,
      },
    });
    const access = await this.signAccessToken(user);
    return {
      accessToken: access.token,
      accessExpiresInS: access.expiresInS,
      refreshToken: refresh.token,
      refreshExpiresAt: refresh.expiresAt,
    };
  }

  private async rotateSession(
    recordId: string,
    familyId: string,
    user: SessionUser,
  ): Promise<SessionTokens> {
    const refresh = this.buildRefreshToken();
    const claimed = await this.prisma.$transaction(async (tx) => {
      const claim = await tx.refreshToken.updateMany({
        where: { id: recordId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (claim.count !== 1) {
        return false;
      }
      await tx.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash: refresh.tokenHash,
          familyId,
          expiresAt: refresh.expiresAt,
        },
      });
      return true;
    });
    if (!claimed) {
      await this.revokeFamily(familyId);
      throw new UnauthorizedException(REUSE_DETECTED_MESSAGE);
    }
    const access = await this.signAccessToken(user);
    return {
      accessToken: access.token,
      accessExpiresInS: access.expiresInS,
      refreshToken: refresh.token,
      refreshExpiresAt: refresh.expiresAt,
    };
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async login(email: string, password: string): Promise<AuthenticatedSession> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        isActive: true,
        passwordHash: true,
      },
    });
    const passwordValid = await this.argon2password.verify(
      user?.passwordHash ?? DUMMY_PASSWORD_HASH,
      password,
    );
    if (user === null || !user.isActive || !passwordValid) {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }
    const sessionUser: SessionUser = {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
    };
    return {
      user: sessionUser,
      tokens: await this.issueSession(sessionUser, randomUUID()),
    };
  }

  async refresh(presentedToken: string): Promise<AuthenticatedSession> {
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashRefreshToken(presentedToken) },
      select: {
        id: true,
        familyId: true,
        revokedAt: true,
        expiresAt: true,
        user: {
          select: {
            id: true,
            email: true,
            fullName: true,
            role: true,
            isActive: true,
          },
        },
      },
    });
    if (record === null) {
      throw new UnauthorizedException(INVALID_REFRESH_MESSAGE);
    }
    if (record.revokedAt !== null) {
      await this.revokeFamily(record.familyId);
      throw new UnauthorizedException(REUSE_DETECTED_MESSAGE);
    }
    if (record.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException(EXPIRED_REFRESH_MESSAGE);
    }
    if (!record.user.isActive) {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }
    const sessionUser: SessionUser = {
      id: record.user.id,
      email: record.user.email,
      fullName: record.user.fullName,
      role: record.user.role,
    };
    return {
      user: sessionUser,
      tokens: await this.rotateSession(record.id, record.familyId, sessionUser),
    };
  }

  async logout(presentedToken: string): Promise<void> {
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashRefreshToken(presentedToken) },
      select: { familyId: true, revokedAt: true },
    });
    if (record !== null && record.revokedAt === null) {
      await this.revokeFamily(record.familyId);
    }
  }

  async getProfile(userId: string): Promise<SessionUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        isActive: true,
      },
    });
    if (user === null || !user.isActive) {
      throw new UnauthorizedException(INACTIVE_ACCOUNT_MESSAGE);
    }
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
    };
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        isActive: true,
        passwordHash: true,
      },
    });

    if (user === null || !user.isActive) {
      throw new UnauthorizedException(INACTIVE_ACCOUNT_MESSAGE);
    }

    const valid = await this.argon2password.verify(
      user.passwordHash,
      currentPassword,
    );

    if (!valid) {
      throw new UnauthorizedException(WRONG_PASSWORD_MESSAGE);
    }

    const passwordHash = await this.argon2password.hash(newPassword);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash },
      });

      await tx.refreshToken.updateMany({
        where: {
          userId: user.id,
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
        },
      });
    });
  }
}
