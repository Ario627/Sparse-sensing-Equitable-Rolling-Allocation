import { UserRole } from '../generated/prisma/client.ts';

export interface AccessTokenPayload {
  readonly sub: string;
  readonly role: UserRole;
}

export interface AuthenticatedUser {
  readonly id: string;
  readonly role: UserRole;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

const BEARER_PATTERN = /^Bearer\s+(\S+)$/i;

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && Object.hasOwn(UserRole, value);
}

export function extractBearerToken(headers: {
  readonly authorization?: string | undefined;
}): string | null {
  const header = headers.authorization;
  const match = typeof header === 'string' ? BEARER_PATTERN.exec(header) : null;
  return match?.[1] ?? null;
}

export function toAuthenticatedUser(
  payload: AccessTokenPayload,
): AuthenticatedUser | null {
  const { sub, role } = payload;
  if (typeof sub !== 'string' || sub.length === 0 || !isUserRole(role)) {
    return null;
  }
  return { id: sub, role };
}
