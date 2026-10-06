import type { UserRole } from '../generated/prisma/client.ts';

export const USER_NOT_FOUND_MESSAGE = 'User not found';
export const SELF_DEACTIVATION_MESSAGE =
  'You cannot deactivate your own account';
export const LAST_ADMIN_MESSAGE = 'At least one active admin must remain';
export const ADMIN_ROLE: UserRole = 'ADMIN';
export const UPDATE_AUDIT_ACTION = 'user.update';
export const MEMBERSHIP_ASSIGN_AUDIT_ACTION = 'user.membership_assign';
export const MEMBERSHIP_REMOVE_AUDIT_ACTION = 'user.membership_remove';
export const USER_ENTITY = 'User';
export const P3A_NOT_FOUND_MESSAGE = 'P3A not found';
export const MEMBERSHIP_NOT_FOUND_MESSAGE = 'Membership not found';
