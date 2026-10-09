import { z } from "zod";

export const userRoleSchema = z.enum([
  "ADMIN",
  "OPERATOR",
  "RESEARCHER",
  "VIEWER",
]);

export const loginRequestSchema = z.strictObject({
  email: z.email(),
  password: z.string().min(8).max(128),
});

export const sessionUserSchema = z.strictObject({
  id: z.uuid(),
  email: z.email(),
  full_name: z.string().min(1).max(120),
  role: userRoleSchema,
});

export const authSessionResponseSchema = z.strictObject({
  access_token: z.string().min(1),
  token_type: z.literal("Bearer"),
  expires_in: z.int().positive(),
  user: sessionUserSchema,
});

export const meResponseSchema = z.strictObject({
  user: sessionUserSchema,
});

export type UserRole = z.infer<typeof userRoleSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type SessionUserResponse = z.infer<typeof sessionUserSchema>;
export type AuthSessionResponse = z.infer<typeof authSessionResponseSchema>;
export type MeResponse = z.infer<typeof meResponseSchema>;