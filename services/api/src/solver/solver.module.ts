import { Module } from '@nestjs/common';
import { SolverHttpService } from './solver-http.service.ts';
import { SolverClient } from './solver.client.ts';
import { SolverExperimentsClient } from './solver-experiments.client.ts';

@Module({
  providers: [SolverHttpService, SolverClient, SolverExperimentsClient],
  exports: [SolverClient, SolverExperimentsClient],
})
export class SolverModule {}
