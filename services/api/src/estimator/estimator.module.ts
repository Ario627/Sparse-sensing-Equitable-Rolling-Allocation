import { Module } from '@nestjs/common';
import { SolverModule } from '../solver/solver.module.ts';
import { EstimatorController } from './estimator.controller.ts';
import { EstimatorReadService } from './estimator-read.service.ts';
import { EstimatorRepository } from './estimator.repository.ts';
import { EstimatorScheduler } from './estimator.scheduler.ts';
import { EstimatorService } from './estimator.service.ts';

@Module({
  imports: [SolverModule],
  controllers: [EstimatorController],
  providers: [
    EstimatorRepository,
    EstimatorReadService,
    EstimatorService,
    EstimatorScheduler,
  ],
  exports: [EstimatorService],
})
export class EstimatorModule {}
