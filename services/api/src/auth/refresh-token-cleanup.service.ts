import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../common/config/env.ts';
import { PrismaService } from '../prisma/prisma.service.ts';

const MILLISECONDS_PER_SECOND = 1_000;
const MILLISECONDS_PER_DAY = 86_400_000;
const CLEANUP_BATCH_SIZE = 5_000;

@Injectable()
export class RefreshTokenCleanupService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(RefreshTokenCleanupService.name);
  private readonly intervalMs: number;
  private readonly retentionMs: number;
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
  ) {
    this.intervalMs =
      config.get('REFRESH_CLEANUP_INTERVAL_S', { infer: true }) *
      MILLISECONDS_PER_SECOND;
    this.retentionMs =
      config.get('REFRESH_TOKEN_RETENTION_D', { infer: true }) *
      MILLISECONDS_PER_DAY;
  }

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
  }

  onModuleDestroy(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async purgeOnce(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - this.retentionMs);
    const stale = await this.prisma.refreshToken.findMany({
      where: {
        OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }],
      },
      orderBy: [{ issuedAt: 'asc' }, { id: 'asc' }],
      take: CLEANUP_BATCH_SIZE,
      select: { id: true },
    });
    if (stale.length === 0) {
      return 0;
    }
    const removed = await this.prisma.refreshToken.deleteMany({
      where: { id: { in: stale.map((row) => row.id) } },
    });
    return removed.count;
  }

  private async tick(): Promise<void> {
    if (this.running) {
      this.logger.debug('refresh cleanup skipped: previous run still active');
      return;
    }
    this.running = true;
    try {
      const deleted = await this.purgeOnce(new Date());
      if (deleted > 0) {
        this.logger.log(`refresh cleanup removed ${deleted} tokens`);
      }
    } catch (error) {
      this.logger.error(
        'refresh cleanup failed',
        error instanceof Error ? error.stack : undefined,
      );
    } finally {
      this.running = false;
    }
  }
}
