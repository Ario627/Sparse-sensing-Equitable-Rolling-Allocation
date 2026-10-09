import type { Env } from '../common/config/env.ts';
import {
  loginRequestSchema,
  type AuthSessionResponse,
  type LoginRequest,
  type MeResponse,
} from '@sera/contracts';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  Put,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { AuthenticatedUser } from './access-token.ts';
import { CurrentUser, Public } from './auth.decorators.ts';
import {
  AuthService,
  type AuthenticatedSession,
  type SessionUser,
} from './auth.service.ts';
import { changePasswordRequestSchema, type ChangePasswordRequest } from '@sera/contracts';

const REFRESH_COOKIE_NAME = 'sera_refresh';
const REFRESH_COOKIE_PATH = '/v1/auth';
const REFRESH_COOKIE_SAME_SITE = 'lax';
const MISSING_REFRESH_MESSAGE = 'Missing refresh token';
const LOGIN_RATE_LIMIT = { default: { limit: 5, ttl: 60_000 } };
const REFRESH_RATE_LIMIT = { default: { limit: 30, ttl: 60_000 } };
const LOGOUT_RATE_LIMIT = { default: { limit: 10, ttl: 60_000 } };
const CHANGE_PASSWORD_RATE_LIMIT = { default: { limit: 5, ttl: 60_000 } };

function readRefreshToken(request: Request): string {
  const value: unknown = request.cookies[REFRESH_COOKIE_NAME];
  if (typeof value !== 'string' || value.length === 0) {
    throw new UnauthorizedException(MISSING_REFRESH_MESSAGE);
  }
  return value;
}

function readOptionalRefreshToken(request: Request): string | null {
  const value: unknown = request.cookies[REFRESH_COOKIE_NAME];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function toWireUser(user: SessionUser): MeResponse['user'] {
  return {
    id: user.id,
    email: user.email,
    full_name: user.fullName,
    role: user.role,
  };
}

function toSessionResponse(session: AuthenticatedSession): AuthSessionResponse {
  return {
    access_token: session.tokens.accessToken,
    token_type: 'Bearer',
    expires_in: session.tokens.accessExpiresInS,
    user: toWireUser(session.user),
  };
}

@Controller('auth')
export class AuthController {
  private readonly secureCookies: boolean;

  constructor(
    private readonly authService: AuthService,
    config: ConfigService<Env, true>,
  ) {
    this.secureCookies =
      config.get('NODE_ENV', { infer: true }) === 'production';
  }

  private setRefreshCookie(
    response: Response,
    session: AuthenticatedSession,
  ): void {
    response.cookie(REFRESH_COOKIE_NAME, session.tokens.refreshToken, {
      httpOnly: true,
      secure: this.secureCookies,
      sameSite: REFRESH_COOKIE_SAME_SITE,
      path: REFRESH_COOKIE_PATH,
      expires: session.tokens.refreshExpiresAt,
    });
  }

  private clearRefreshCookie(response: Response): void {
    response.clearCookie(REFRESH_COOKIE_NAME, {
      httpOnly: true,
      secure: this.secureCookies,
      sameSite: REFRESH_COOKIE_SAME_SITE,
      path: REFRESH_COOKIE_PATH,
    });
  }

  @Public()
  @Post('login')
  @Throttle(LOGIN_RATE_LIMIT)
  async login(
    @Body({ schema: loginRequestSchema }) body: LoginRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthSessionResponse> {
    const session = await this.authService.login(body.email, body.password);
    this.setRefreshCookie(response, session);
    return toSessionResponse(session);
  }

  @Public()
  @Post('refresh')
  @Throttle(REFRESH_RATE_LIMIT)
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthSessionResponse> {
    const session = await this.authService.refresh(readRefreshToken(request));
    this.setRefreshCookie(response, session);
    return toSessionResponse(session);
  }

  @Public()
  @Post('logout')
  @Throttle(LOGOUT_RATE_LIMIT)
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const token = readOptionalRefreshToken(request);
    if (token !== null) {
      await this.authService.logout(token);
    }
    this.clearRefreshCookie(response);
  }

  @Put('password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle(CHANGE_PASSWORD_RATE_LIMIT)
  async changePassword(
    @Body({ schema: changePasswordRequestSchema })
    body: ChangePasswordRequest,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.authService.changePassword(
      user.id,
      body.current_password,
      body.new_password,
    );
    this.clearRefreshCookie(response);
  }

  @Get('me')
  async me(@CurrentUser() user: AuthenticatedUser): Promise<MeResponse> {
    return { user: toWireUser(await this.authService.getProfile(user.id)) };
  }
}
