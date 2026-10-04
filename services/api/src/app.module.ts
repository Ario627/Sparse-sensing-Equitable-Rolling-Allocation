import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { envSchema } from './common/config/env.ts';
import { PrismaModule } from './prisma/prisma.module.ts';
import { HealthModule } from './health/health.module.ts';
import { HttpExceptionFilter } from './common/filters/http-exception.filter.ts';
import {ThrottlerGuard, ThrottlerModule}  from "@nestjs/throttler";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { AuthModule } from './auth/auth.module.ts';
import { JwtAuthGuard, RolesGuard } from './auth/auth.guard.ts';
import { UsersModule } from './users/users.module.ts';


const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_RATE_LIMIT = { ttl: 60_000, limit: 120 };
const RATE_LIMIT_MESSAGE = 'Too Many Requests';

function resolveEnvFiles(): string[] {
  return [
    path.resolve(MODULE_DIR, '../.env'),
    path.resolve(MODULE_DIR, '../../../docker/.env'),
  ];
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: resolveEnvFiles(),
      validationSchema: envSchema,
    }),
    ThrottlerModule.forRoot({
      throttlers: [DEFAULT_RATE_LIMIT],
      errorMessage: RATE_LIMIT_MESSAGE,
    }),
    PrismaModule,
    HealthModule,
    AuthModule,
    UsersModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
