import type { PlanSortField, SortOrder } from "@sera/contracts";
import type { Prisma } from "../generated/prisma/client.ts";
import type { PlanHistoryFilter } from "./plans.types.ts";



const PLAN_SORT_BUILDERS: Readonly<
  Record<
    PlanSortField,
    (order: SortOrder) => Prisma.PlanOrderByWithRelationInput
  >
> = {
  created_at: (order) => ({ createdAt: order }),
  horizon_from: (order) => ({ horizonFrom: order }),
  updated_at: (order) => ({ updatedAt: order }),
};

function buildCreateAtRange(
    filter: PlanHistoryFilter,
): Prisma.DateTimeFilter | undefined {
    if (filter.from === undefined && filter.to === undefined) {
        return undefined;
    }


    return {
        ...(filter.from === undefined ? {} : { gte: filter.from }),
        ...(filter.to === undefined ? {} : { lte: filter.to }),
    };
}

export function buildPlanWhere(
    filter: PlanHistoryFilter,
): Prisma.PlanWhereInput {
    const createdAt = buildCreateAtRange(filter);

    return {
        ...(filter.networkId === undefined ? {} : { networkId: filter.networkId }),
        ...(filter.status === undefined ? {} : { status: filter.status }),
        ...(filter.profile === undefined ? {} : { profile: filter.profile }),
        ...(filter.blockId === undefined
        ? {}
        : { items: { some: { blockId: filter.blockId } } }),
        ...(createdAt === undefined ? {} : { createdAt }),
    }
}


export function buildPlanOrderBy(
  sort: PlanSortField,
  order: SortOrder,
): Prisma.PlanOrderByWithRelationInput[] {
  return [PLAN_SORT_BUILDERS[sort](order), { id: order }];
}