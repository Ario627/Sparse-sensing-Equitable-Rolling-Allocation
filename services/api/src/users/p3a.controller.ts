import { Controller, Get } from '@nestjs/common';
import type { P3aListResponse } from '@sera/contracts';
import { Roles } from '../auth/auth.decorators.ts';
import { P3aService, type P3aRecord } from './p3a.service.ts';

const ADMIN_ROLE = 'ADMIN' as const;

function toP3aResponse(record: P3aRecord): P3aListResponse['items'][number] {
  return {
    id: record.id,
    name: record.name,
    region: record.region,
    member_count: record.memberCount,
    created_at: record.createdAt.toISOString(),
  };
}


@Controller('p3a')
@Roles(ADMIN_ROLE)
export class P3aController {
    constructor(private readonly p3aService: P3aService) {}

    @Get()
    async list(): Promise<P3aListResponse> {
        const organizations = await this.p3aService.listOrganizations();
        return {
            items: organizations.map(toP3aResponse),
        };
    }
}