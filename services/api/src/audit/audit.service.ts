import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditRepository } from './audit.repository.ts';
import { AUDIT_MESSAGES } from './audit.constant.ts';
import type {
  AuditFacetsRecord,
  AuditListPage,
  AuditListQuery,
  AuditLogRecord,
} from './audit.types.ts';

@Injectable()
export class AuditService {
  constructor(private readonly repository: AuditRepository) {}

  list(query: AuditListQuery): Promise<AuditListPage> {
    return this.repository.listAuditLogs(query);
  }

  facets(): Promise<AuditFacetsRecord> {
    return this.repository.loadFacets();
  }

  async getById(id: string): Promise<AuditLogRecord> {
    const entry = await this.repository.findAuditLogById(id);
    if (entry === null) {
      throw new NotFoundException(AUDIT_MESSAGES.notFound);
    }
    return entry;
  }
}
