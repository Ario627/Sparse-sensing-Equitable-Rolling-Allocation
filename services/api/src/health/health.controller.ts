import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../auth/auth.decorators.ts';
import { PrismaService } from '../prisma/prisma.service.ts';

const READINESS_PROBE_TIMEOUT_MS = 2_000;

interface ProbeResult {
  readonly status: 'up' | 'down';
  readonly latency_ms: number | null;
}

interface LivenessReport {
  readonly status: 'ok';
  readonly uptime_s: number;
}

interface ReadinessReport {
  readonly status: 'ok' | 'degraded';
  readonly checks: {
    readonly database: ProbeResult;
  };
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('probe timed out')),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function probeDatabase(prisma: PrismaService): Promise<ProbeResult> {
  const startedAt = performance.now();
  try {
    await withTimeout(prisma.$queryRaw`SELECT 1`, READINESS_PROBE_TIMEOUT_MS);
    return {
      status: 'up',
      latency_ms: Math.round(performance.now() - startedAt),
    };
  } catch {
    return { status: 'down', latency_ms: null };
  }
}

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  liveness(): LivenessReport {
    return { status: 'ok', uptime_s: Math.floor(process.uptime()) };
  }

  @Public()
  @Get('ready')
  async readiness(
    @Res({ passthrough: true }) response: Response,
  ): Promise<ReadinessReport> {
    const database = await probeDatabase(this.prisma);
    if (database.status === 'down') {
      response.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return {
      status: database.status === 'down' ? 'degraded' : 'ok',
      checks: { database },
    };
  }
}
