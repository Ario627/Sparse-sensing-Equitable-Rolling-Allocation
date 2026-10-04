import { Module } from '@nestjs/common';
import { SolverClient } from './solver.client.ts';

@Module({
  providers: [SolverClient],
  exports: [SolverClient],
})
export class SolverModule {}
