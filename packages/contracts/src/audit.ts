import { z } from "zod";
import { pageSchema, pageSizeSchema, sortOrderSchema } from "./query.ts";

export const auditLogIdSchema = z.uuid();

const AUDIT_ACTION_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+$/;
const AUDIT_ENTITY_PATTERN = /^[A-Z][A-Za-z0-9]*$/;

export const auditActionSchema = z.string().max(64).regex(AUDIT_ACTION_PATTERN);

export const auditEntitySchema = z.string().max(40).regex(AUDIT_ENTITY_PATTERN);

export const listAuditQuerySchema = z
  .strictObject({
    action: auditActionSchema.optional(),
    entity: auditEntitySchema.optional(),
    entity_id: z.uuid().optional(),
    user_id: z.uuid().optional(),
    q: z
      .string()
      .trim()
      .max(120)
      .optional()
      .transform((value) =>
        value === undefined || value.length === 0 ? undefined : value,
      ),
    from: z.iso.datetime().optional(),
    to: z.iso.datetime().optional(),
    page: pageSchema,
    limit: pageSizeSchema,
    order: sortOrderSchema.default("desc"),
  })
  .refine(
    (value) =>
      value.from === undefined ||
      value.to === undefined ||
      Date.parse(value.from) <= Date.parse(value.to),
    { error: "from must not be later than to" },
  );

export const auditActorSchema = z.strictObject({
  id: z.uuid(),
  full_name: z.string().min(1),
  email: z.email(),
});

export const auditLogSchema = z.strictObject({
  id: z.uuid(),
  actor: auditActorSchema.nullable(),
  action: z.string().min(1),
  entity: z.string().min(1),
  entity_id: z.string().nullable(),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  ip: z.string().nullable(),
  user_agent: z.string().nullable(),
  created_at: z.iso.datetime(),
});

export const auditListResponseSchema = z.strictObject({
  items: z.array(auditLogSchema),
  page: z.int().positive(),
  limit: z.int().positive(),
  total: z.int().nonnegative(),
  total_pages: z.int().positive(),
});

export const auditFacetSchema = z.strictObject({
  value: z.string().min(1),
  count: z.int().nonnegative(),
});

export const auditFacetsResponseSchema = z.strictObject({
  actions: z.array(auditFacetSchema),
  entities: z.array(auditFacetSchema),
});

export type ListAuditQuery = z.infer<typeof listAuditQuerySchema>;
export type AuditActorResponse = z.infer<typeof auditActorSchema>;
export type AuditLogResponse = z.infer<typeof auditLogSchema>;
export type AuditListResponse = z.infer<typeof auditListResponseSchema>;
export type AuditFacetResponse = z.infer<typeof auditFacetSchema>;
export type AuditFacetsResponse = z.infer<typeof auditFacetsResponseSchema>;
