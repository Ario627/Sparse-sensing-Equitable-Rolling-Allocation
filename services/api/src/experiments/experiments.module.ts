import { Module } from '@nestjs/common';
import { SolverModule } from '../solver/solver.module.ts';
import { ExperimentsController } from './experiments.controller.ts';
import { ExperimentsProgressService } from './experiments.progress.service.ts';
import { ExperimentsRepository } from './experiments.repository.ts';
import { ExperimentsService } from './experiments.service.ts';

@Module({
  imports: [SolverModule],
  controllers: [ExperimentsController],
  providers: [
    ExperimentsRepository,
    ExperimentsService,
    ExperimentsProgressService,
  ],
  exports: [ExperimentsService],
})
export class ExperimentsModule {}
