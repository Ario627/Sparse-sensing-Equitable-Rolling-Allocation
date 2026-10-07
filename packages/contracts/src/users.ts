import { z } from "zod";
import { userRoleSchema } from "./auth.ts";
import { pageSchema, pageSizeSchema, sortOrderSchema } from "./query.ts";
import { passwordPolicySchema } from "./password.ts";

export const userIdSchema = z.uuid();

export const userSortFieldSchema = z.enum(["created_at", "full_name", "email"]);


export const userSummarySchema = z.strictObject({
  id: z.uuid(),
  email: z.email(),
  full_name: z.string().min(1).max(120),
  role: userRoleSchema,
  is_active: z.boolean(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});

export const userMembershipSchema = z.strictObject({
  p3a_id: z.uuid(),
  p3a_name: z.string().min(1).max(160),
  region: z.string().max(120).nullable(),
  role: z.string().min(1).max(40),
});

export const userDetailSchema = userSummarySchema.extend({
  memberships: z.array(userMembershipSchema),
});

export const listUsersQuerySchema = z.strictObject({
  q: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((value) =>
      value === undefined || value.length === 0 ? undefined : value,
    ),
  role: userRoleSchema.optional(),
  is_active: z.stringbool().optional(),
  page: pageSchema,
  limit: pageSizeSchema,
  sort: userSortFieldSchema.default("created_at"),
  order: sortOrderSchema.default("desc"),
});

export const usersListResponseSchema = z.strictObject({
  items: z.array(userSummarySchema),
  page: z.int().positive(),
  limit: z.int().positive(),
  total: z.int().nonnegative(),
  total_pages: z.int().positive(),
});

export const createUserRequestSchema = z.strictObject({
  email: z.email(),
  full_name: z.string().trim().min(1).max(120),
  role: userRoleSchema,
  initial_password: passwordPolicySchema,
});

export const updateUserRequestSchema = z
  .strictObject({
    full_name: z.string().trim().min(1).max(120).optional(),
    role: userRoleSchema.optional(),
    is_active: z.boolean().optional(),
  })
  .refine(
    (value) => Object.values(value).some((field) => field !== undefined),
    { error: "at least one field must be provided" },
  );

export type UserSortField = z.infer<typeof userSortFieldSchema>;
export type UserSummary = z.infer<typeof userSummarySchema>;
export type UserMembership = z.infer<typeof userMembershipSchema>;
export type UserDetailResponse = z.infer<typeof userDetailSchema>;
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
export type UsersListResponse = z.infer<typeof usersListResponseSchema>;
export type UpdateUserRequest = z.infer<typeof updateUserRequestSchema>;
export type CreateUserRequest = z.infer<typeof createUserRequestSchema>;
