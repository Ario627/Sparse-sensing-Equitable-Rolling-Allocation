import type { UserRole } from '../generated/prisma/client.ts';
import argon2 from 'argon2';
import type { HashOptions } from 'argon2'; 

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
export const P3A_ENTITY = 'P3A';
export const P3A_CREATE_AUDIT_ACTION = 'p3a.create';
export const P3A_UPDATE_AUDIT_ACTION = 'p3a.update';
export const MEMBERSHIP_NOT_FOUND_MESSAGE = 'Membership not found';
export const USER_CREATED_MESSAGE = 'User is already registered';
export const USER_EMAIL_TAKEN_MESSAGE = 'Email is already registered';
export const PASSWORD_CHANGE_AUDIT_ACTION = 'user.password_change';
export const PASSWORD_RESET_AUDIT_ACTION = 'user.password_reset';
export const HASH_OPTIONS: HashOptions = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};