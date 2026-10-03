import { z } from 'zod';

const DURATION_UNITS = {
  s: 1,
  m: 60,
  h: 3_600,
  d: 86_400,
} as const;

function parseDurationSeconds(value: string): number {
  const amount = Number.parseInt(value, 10);
  const unit = value.at(-1);
  if (unit !== 's' && unit !== 'm' && unit !== 'h' && unit !== 'd') {
    throw new RangeError(`unsupported duration unit "${String(unit)}"`);
  }
  return amount * DURATION_UNITS[unit];
}

function durationSchema(fallback: string, label: string) {
  return z
    .string()
    .regex(/^\d+[smhd]$/, `${label} must look like 30s, 15m, 2h, or 7d`)
    .refine(
      (value) => Number.parseInt(value, 10) > 0,
      `${label} must be positive`,
    )
    .default(fallback)
    .transform(parseDurationSeconds);
}

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'demo', 'production'])
    .default('development'),
  API_PORT: z.coerce.number().int().min(1024).max(65_535).default(3000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  DATABASE_URL: z.url({ protocol: /^postgresql?$/ }),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0),
    ),
  JWT_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: durationSchema('15m', 'JWT_ACCESS_TTL'),
  JWT_REFRESH_TTL: durationSchema('7d', 'JWT_REFRESH_TTL'),
  MQTT_URL: z.url({ protocol: /^mqtts?$/ }).default('mqtt://localhost:1883'),
  MQTT_CLIENT_ID: z.string().min(1).max(128).default('sera-api'),
  MQTT_USERNAME: z.string().min(1).optional(),
  MQTT_PASSWORD: z.string().min(1).optional(),
  MQTT_TOPIC_PREFIX: z
    .string()
    .regex(/^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/)
    .default('sera'),
  SOLVER_URL: z.url({ protocol: /^https?$/ }).default('http://localhost:8000'),
  SOLVER_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(250)
    .max(300_000)
    .default(30_000),
  SOLVER_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(2),
  TELEMETRY_MAX_SKEW_S: z.coerce.number().int().min(10).max(3_600).default(300),
  COMMAND_TTL_S: z.coerce.number().int().min(10).max(3_600).default(300),
  EXPERIMENT_MAX_RUNS: z.coerce
    .number()
    .int()
    .min(1)
    .max(100_000)
    .default(5_000),
});

export type Env = z.infer<typeof envSchema>;
