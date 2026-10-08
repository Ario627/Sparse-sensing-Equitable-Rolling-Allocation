import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../common/config/env.ts';
import { EstimatorService } from './estimator.service.ts';

const MILLISECONDS_PER_SECOND = 1_000;

@Injectable()
export class EstimatorScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EstimatorScheduler.name);
  private readonly intervalMs: number;
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;

  constructor(
    private readonly estimator: EstimatorService,
    config: ConfigService<Env, true>,
  ) {
    this.intervalMs =
      config.get('ESTIMATOR_INTERVAL_S', { infer: true }) *
      MILLISECONDS_PER_SECOND;
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

  private async tick(): Promise<void> {
    if (this.running) {
      this.logger.debug('estimator tick skipped: previous run still active');
      return;
    }
    this.running = true;
    try {
      const summary = await this.estimator.runOnce();
      if (summary.estimated > 0) {
        this.logger.log(
          `estimator tick: ${summary.estimated}/${summary.networks} networks estimated`,
        );
      }
    } catch (error) {
      this.logger.error(
        'estimator tick failed',
        error instanceof Error ? error.stack : undefined,
      );
    } finally {
      this.running = false;
    }
  }
}
