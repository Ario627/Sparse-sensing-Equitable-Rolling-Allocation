import { z } from "zod";

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
export const PASSWORD_MIN_CLASSES = 3;

const CHARACTER_CLASSES = [
  /[a-z]/,
  /[A-Z]/,
  /[0-9]/,
  /[^A-Za-z0-9]/,
] as const;

function characterClassCount(password: string): number {
  return CHARACTER_CLASSES.filter((pattern) => pattern.test(password)).length;
}

export const passwordPolicySchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH)
  .max(PASSWORD_MAX_LENGTH)
  .regex(/[a-z]/, "password must contain a lowercase letter")
  .regex(/[A-Z]/, "password must contain an uppercase letter")
  .regex(/[0-9]/, "password must contain a digit")
  .refine(
    (value) => characterClassCount(value) >= PASSWORD_MIN_CLASSES,
    `password must use at least ${PASSWORD_MIN_CLASSES} character classes`,
  );

export const changePasswordRequestSchema = z
  .strictObject({
    current_password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
    new_password: passwordPolicySchema,
  })
  .refine((value) => value.current_password !== value.new_password, {
    error: "new password must differ from the current password",
  });

export const resetPasswordRequestSchema = z.strictObject({
  new_password: passwordPolicySchema,
});

export type ChangePasswordRequest = z.infer<
  typeof changePasswordRequestSchema
>;
export type ResetPasswordRequest = z.infer<
  typeof resetPasswordRequestSchema
>;