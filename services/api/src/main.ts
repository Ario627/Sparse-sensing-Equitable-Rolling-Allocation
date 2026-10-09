import {
  Logger,
  StandardSchemaValidationPipe,
  type LogLevel,
} from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.ts';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Env } from './common/config/env.ts';
import { createSecurityHeadersMiddleware } from './common/middleware/security-headers.ts';

const GLOBAL_PREFIX = 'v1';
const INFRA_ROUTES = ['health', 'health/ready'];
const PREFLIGHT_MAX_AGE_SECONDS = 600;
const TRUSTED_PROXY_HOPS = 1;

const LOG_LEVELS: Readonly<Record<Env['LOG_LEVEL'], LogLevel[]>> = {
  debug: ['error', 'warn', 'log', 'debug', 'verbose'],
  info: ['error', 'warn', 'log'],
  warn: ['error', 'warn'],
  error: ['error'],
};

function configureCors(app: NestExpressApplication, origins: string[]): void {
  app.enableCors({
    origin: origins,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    maxAge: PREFLIGHT_MAX_AGE_SECONDS,
  });
}

function configureSecurity(
  app: NestExpressApplication,
  isProduction: boolean,
): void {
  if (isProduction) {
    app.set('trust proxy', TRUSTED_PROXY_HOPS);
  }
  app.use(createSecurityHeadersMiddleware({ hsts: isProduction }));
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const nodeEnv = config.get('NODE_ENV', { infer: true });
  const port = config.get('API_PORT', { infer: true });
  const logger = new Logger('Bootstrap');

  app.useLogger(LOG_LEVELS[config.get('LOG_LEVEL', { infer: true })]);
  app.setGlobalPrefix(GLOBAL_PREFIX, { exclude: INFRA_ROUTES });
  app.useGlobalPipes(new StandardSchemaValidationPipe());
  configureCors(app, config.get('CORS_ORIGINS', { infer: true }));
  configureSecurity(app, nodeEnv === 'production');
  app.use(cookieParser());
  app.enableShutdownHooks();

  await app.listen(port);
  logger.log(`SERA API ${nodeEnv} listening on ${await app.getUrl()}`);
}

await bootstrap();