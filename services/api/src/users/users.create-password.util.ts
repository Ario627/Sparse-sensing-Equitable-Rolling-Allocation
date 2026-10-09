import type { Prisma } from '../generated/prisma/client.ts';

export interface UserCreateRequest {
  readonly email: string;
  readonly fullName: string;
  readonly role: Prisma.UserCreateInput['role'];
  readonly initialPassword: string;
}

export interface UserPatchRequest {
  readonly fullName?: string;
  readonly role?: Prisma.UserCreateInput['role'];
  readonly isActive?: boolean;
  readonly currentPassword?: string;
  readonly newPassword?: string;
}

export function pickFieldFromDiff<
  T extends Record<string, unknown>,
  K extends keyof T,
>(current: T, next: T, field: K): T[K] | undefined {
  return current[field] === next[field] ? undefined : next[field];
}

export function fetchUserForPasswordChange(user: {
  readonly id: string;
  readonly passwordHash: string;
  readonly isActive: boolean;
}): { readonly id: string; readonly passwordHash: string } | null {
  return user.isActive
    ? { id: user.id, passwordHash: user.passwordHash }
    : null;
}
