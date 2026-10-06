import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.ts';
import { PrismaService } from '../prisma/prisma.service.ts';

export interface P3aRecord {
  readonly id: string;
  readonly name: string;
  readonly region: string | null;
  readonly memberCount: number;
  readonly createdAt: Date;
}

const P3A_SELECT = {
  id: true,
  name: true,
  region: true,
  createdAt: true,
  _count: { select: { memberships: true } },
} satisfies Prisma.P3ASelect;

type P3aRow = Prisma.P3AGetPayload<{ select: typeof P3A_SELECT }>;

function toP3aRecord(row: P3aRow): P3aRecord {
    return {
        id: row.id,
        name: row.name,
        region: row.region,
        memberCount: row._count.memberships,
        createdAt: row.createdAt
    }
}

@Injectable()
export class P3aService {
  constructor(private readonly prisma: PrismaService) {}

  async listOrganizations(): Promise<readonly P3aRecord[]> {
    const rows = await this.prisma.p3A.findMany({
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: P3A_SELECT,
    });
    return rows.map(toP3aRecord);
  }
}