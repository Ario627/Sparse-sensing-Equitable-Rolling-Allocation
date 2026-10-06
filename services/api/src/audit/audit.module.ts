import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller.ts';
import { AuditRepository } from './audit.repository.ts';
import { AuditService } from './audit.service.ts';

@Module({
  controllers: [AuditController],
  providers: [AuditRepository, AuditService],
})
export class AuditModule {}
