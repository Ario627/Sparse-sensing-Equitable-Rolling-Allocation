import { Module } from '@nestjs/common';
import { LedgerController } from './ledger.controller.ts';
import { LedgerRepository } from './ledger.repository.ts';
import { LedgerScheduler } from './ledger.scheduler.ts';
import { LedgerService } from './ledger.service.ts';

@Module({
  controllers: [LedgerController],
  providers: [LedgerRepository, LedgerService, LedgerScheduler],
  exports: [LedgerService],
})
export class LedgerModule {}
