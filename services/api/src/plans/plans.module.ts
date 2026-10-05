import { Module } from '@nestjs/common';
import { MqttModule } from '../mqtt/mqtt.module.ts';
import { SolverModule } from '../solver/solver.module.ts';
import { PlanDecisionService } from './plans.decision.service.ts';
import { PlanExecutionService } from './plans.execution.service.ts';
import { PlanProposalService } from './plans.proposal.service.ts';
import { PlansController } from './plans.controller.ts';
import { PlansRepository } from './plans.repository.ts';
import { PlansService } from './plans.service.ts';

@Module({
  imports: [MqttModule, SolverModule],
  controllers: [PlansController],
  providers: [
    PlansRepository,
    PlanProposalService,
    PlanDecisionService,
    PlanExecutionService,
    PlansService,
  ],
  exports: [PlansService],
})
export class PlansModule {}
