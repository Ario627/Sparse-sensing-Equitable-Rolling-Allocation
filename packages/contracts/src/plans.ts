import { z } from "zod";
import { policyProfileSchema } from "./envelope.ts";
import { pageSchema, pageSizeSchema, sortOrderSchema } from "./query.ts";

export const planIdSchema = z.uuid();

export const planStatusSchema = z.enum([
  "PROPOSED",
  "APPROVED",
  "EXECUTED",
  "SUPERSEDED",
  "FALLBACK",
]);

export const planDecisionActionSchema = z.enum([
  "approve",
  "reject",
  "request_changes",
]);

export const planSortFieldSchema = z.enum([
  "created_at",
  "horizon_from",
  "updated_at",
]);

function withinRange(value: {
  readonly from?: string | undefined;
  readonly to?: string | undefined;
}): boolean {
  return (
    value.from === undefined ||
    value.to === undefined ||
    Date.parse(value.from) <= Date.parse(value.to)
  );
}

const historyFilterShape = {
  network_id: z.uuid().optional(),
  status: planStatusSchema.optional(),
  profile: policyProfileSchema.optional(),
  block_id: z.uuid().optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  sort: planSortFieldSchema.default("created_at"),
  order: sortOrderSchema.default("desc"),
} as const;

export const proposePlanRequestSchema = z.strictObject({
  network_id: z.uuid(),
  profile: policyProfileSchema.default("BALANCED"),
  horizon_h: z.int().min(1).max(168).optional(),
});

export const planDecisionRequestSchema = z
  .strictObject({
    action: planDecisionActionSchema,
    reason: z.string().trim().min(1).max(160).optional(),
  })
  .refine((value) => value.action === "approve" || value.reason !== undefined, {
    error: "reason is required for reject and request_changes",
  });

export const planOverrideItemChangeSchema = z.strictObject({
  item_id: z.uuid(),
  gate_open: z.boolean(),
});

export const planOverrideRequestSchema = z
  .strictObject({
    reason: z.string().trim().min(1).max(160),
    items: z.array(planOverrideItemChangeSchema).min(1).max(200),
  })
  .refine(
    (value) =>
      new Set(value.items.map((item) => item.item_id)).size ===
      value.items.length,
    { error: "override items must be unique" },
  );

export const listPlansQuerySchema = z
  .strictObject({
    ...historyFilterShape,
    page: pageSchema,
    limit: pageSizeSchema,
  })
  .refine(withinRange, { error: "from must not be later than to" });

export const exportPlansQuerySchema = z
  .strictObject({ ...historyFilterShape })
  .refine(withinRange, { error: "from must not be later than to" });

export const planApprovalSummarySchema = z.strictObject({
  action: z.enum(["APPROVE", "REJECT", "REQUEST_CHANGES"]),
  user_name: z.string().min(1),
  reason: z.string().nullable(),
  created_at: z.iso.datetime(),
});

export const planOverrideSummarySchema = z.strictObject({
  user_name: z.string().min(1),
  reason: z.string().min(1),
  created_at: z.iso.datetime(),
});

export const planSummarySchema = z.strictObject({
  id: z.uuid(),
  network_id: z.uuid(),
  network_name: z.string().min(1),
  status: planStatusSchema,
  profile: policyProfileSchema,
  horizon_from: z.iso.datetime(),
  horizon_to: z.iso.datetime(),
  solver_name: z.string().nullable(),
  solver_time_ms: z.int().nonnegative().nullable(),
  mip_gap: z.number().nonnegative().nullable(),
  item_count: z.int().nonnegative(),
  override_count: z.int().nonnegative(),
  last_approval: planApprovalSummarySchema.nullable(),
  last_override: planOverrideSummarySchema.nullable(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});

export const planItemSchema = z.strictObject({
  id: z.uuid(),
  block_id: z.uuid(),
  block_name: z.string().min(1),
  slot_start: z.iso.datetime(),
  slot_end: z.iso.datetime(),
  gate_open: z.boolean(),
  volume_del_m3: z.number().nullable(),
  volume_gross_m3: z.number().nullable(),
  service_ratio_est: z.number().nullable(),
  reason_json: z.unknown().nullable(),
});

export const planApprovalSchema = z.strictObject({
  id: z.uuid(),
  user_id: z.uuid(),
  user_name: z.string().min(1),
  user_email: z.email(),
  action: z.enum(["APPROVE", "REJECT", "REQUEST_CHANGES"]),
  reason: z.string().nullable(),
  created_at: z.iso.datetime(),
});

export const planOverrideSchema = z.strictObject({
  id: z.uuid(),
  user_id: z.uuid(),
  user_name: z.string().min(1),
  reason: z.string().min(1),
  changes: z.array(z.record(z.string(), z.unknown())),
  created_at: z.iso.datetime(),
});

export const planDetailSchema = planSummarySchema.extend({
  items: z.array(planItemSchema),
  approvals: z.array(planApprovalSchema),
  overrides: z.array(planOverrideSchema),
  objective: z.unknown().nullable(),
  binding_factors: z.unknown().nullable(),
});

export const plansListResponseSchema = z.strictObject({
  items: z.array(planSummarySchema),
  page: z.int().positive(),
  limit: z.int().positive(),
  total: z.int().nonnegative(),
  total_pages: z.int().positive(),
});

export type PlanStatus = z.infer<typeof planStatusSchema>;
export type PlanDecisionAction = z.infer<typeof planDecisionActionSchema>;
export type PlanSortField = z.infer<typeof planSortFieldSchema>;
export type ProposePlanRequest = z.infer<typeof proposePlanRequestSchema>;
export type PlanDecisionRequest = z.infer<typeof planDecisionRequestSchema>;
export type PlanOverrideItemChange = z.infer<
  typeof planOverrideItemChangeSchema
>;
export type PlanOverrideRequest = z.infer<typeof planOverrideRequestSchema>;
export type ListPlansQuery = z.infer<typeof listPlansQuerySchema>;
export type ExportPlansQuery = z.infer<typeof exportPlansQuerySchema>;
export type PlanApprovalSummary = z.infer<typeof planApprovalSummarySchema>;
export type PlanOverrideSummary = z.infer<typeof planOverrideSummarySchema>;
export type PlanSummaryResponse = z.infer<typeof planSummarySchema>;
export type PlanItemResponse = z.infer<typeof planItemSchema>;
export type PlanApprovalResponse = z.infer<typeof planApprovalSchema>;
export type PlanOverrideResponse = z.infer<typeof planOverrideSchema>;
export type PlanDetailResponse = z.infer<typeof planDetailSchema>;
export type PlansListResponse = z.infer<typeof plansListResponseSchema>;
