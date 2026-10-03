import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import type { UserRole } from '../generated/prisma/client.ts';
import {
  extractBearerToken,
  toAuthenticatedUser,
  type AccessTokenPayload,
} from './access-token.ts';
import { IS_PUBLIC_KEY, REQUIRED_ROLES_KEY } from './auth.decorators.ts';
import { AUTH_AUDIENCE, AUTH_ISSUER } from './auth.service.ts';

const JWT_ALGORITHM = 'HS256';
const ADMIN_ROLE: UserRole = 'ADMIN';
const MISSING_TOKEN_MESSAGE = 'Missing bearer token';
const INVALID_TOKEN_MESSAGE = 'Invalid or expired access token';
const MISSING_USER_MESSAGE = 'Authenticated user is required';
const FORBIDDEN_MESSAGE = 'Insufficient role for this resource';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.isPublic(context)) {
      return true;
    }
    const request = context.switchToHttp().getRequest<Request>();
    const token = extractBearerToken(request);
    if (token === null) {
      throw new UnauthorizedException(MISSING_TOKEN_MESSAGE);
    }
    const payload = await this.decodeAccessToken(token);
    const user = payload === null ? null : toAuthenticatedUser(payload);
    if (user === null) {
      throw new UnauthorizedException(INVALID_TOKEN_MESSAGE);
    }
    request.user = user;
    return true;
  }

  private isPublic(context: ExecutionContext): boolean {
    return (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? false
    );
  }

  private async decodeAccessToken(
    token: string,
  ): Promise<AccessTokenPayload | null> {
    try {
      return await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        algorithms: [JWT_ALGORITHM],
        issuer: AUTH_ISSUER,
        audience: AUTH_AUDIENCE,
      });
    } catch {
      return null;
    }
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<
      readonly UserRole[] | undefined
    >(REQUIRED_ROLES_KEY, [context.getHandler(), context.getClass()]);
    if (required === undefined || required.length === 0) {
      return true;
    }
    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user;
    if (user === undefined) {
      throw new UnauthorizedException(MISSING_USER_MESSAGE);
    }
    if (user.role === ADMIN_ROLE || required.includes(user.role)) {
      return true;
    }
    throw new ForbiddenException(FORBIDDEN_MESSAGE);
  }
}
