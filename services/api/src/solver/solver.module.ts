import { Module } from '@nestjs/common';
import { SolverEstimateClient } from './solver-estimate.client.ts';
import { SolverExperimentsClient } from './solver-experiments.client.ts';
import { SolverHttpService } from './solver-http.service.ts';
import { SolverClient } from './solver.client.ts';

@Module({
  providers: [
    SolverHttpService,
    SolverClient,
    SolverExperimentsClient,
    SolverEstimateClient,
  ],
  exports: [SolverClient, SolverExperimentsClient, SolverEstimateClient],
})
export class SolverModule {}
