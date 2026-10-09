import type { Request } from 'express';

export interface AuditContext {
  readonly ip?: string;
  readonly userAgent?: string;
}

export function auditContextFrom(request: Request): AuditContext {
  return { ip: request.ip, userAgent: request.get('user-agent') };
}
