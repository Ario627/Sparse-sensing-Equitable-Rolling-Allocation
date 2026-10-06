import { z } from "zod";

export const p3aIdSchema = z.uuid();

export const membershipRoleSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[a-z][a-z0-9_-]*$/, "membership role must be a lowercase slug");

export const upsertMembershipRequestSchema = z.strictObject({
  role: membershipRoleSchema,
});

export const p3aSummarySchema = z.strictObject({
  id: z.uuid(),
  name: z.string().min(1).max(160),
  region: z.string().max(120).nullable(),
  member_count: z.int().nonnegative(),
  created_at: z.iso.datetime(),
});

export const p3aListResponseSchema = z.strictObject({
  items: z.array(p3aSummarySchema),
});

export type MembershipRole = z.infer<typeof membershipRoleSchema>;
export type UpsertMembershipRequest = z.infer<
  typeof upsertMembershipRequestSchema
>;
export type P3aSummaryResponse = z.infer<typeof p3aSummarySchema>;
export type P3aListResponse = z.infer<typeof p3aListResponseSchema>;
