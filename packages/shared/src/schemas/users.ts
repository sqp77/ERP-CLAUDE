import { z } from 'zod';
import { ACCOUNT_STATUSES } from '../enums';
import { emailSchema, objectIdSchema } from './common';

export const roleAssignmentSchema = z.object({
  role: z.string().min(1),
  departmentId: objectIdSchema.optional(),
});

export const createUserSchema = z.object({
  email: emailSchema,
  displayNameAr: z.string().trim().min(2),
  password: z.string().min(8).optional(),
  roles: z.array(roleAssignmentSchema).default([{ role: 'employee' }]),
  employeeId: objectIdSchema.optional(),
  departmentId: objectIdSchema.optional(),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({
  displayNameAr: z.string().trim().min(2).optional(),
  roles: z.array(roleAssignmentSchema).optional(),
  status: z.enum(ACCOUNT_STATUSES).optional(),
  employeeId: objectIdSchema.nullable().optional(),
  departmentId: objectIdSchema.nullable().optional(),
});
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const listUsersQuerySchema = z.object({
  q: z.string().trim().optional(),
  status: z.enum(ACCOUNT_STATUSES).optional(),
  role: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(25),
});

/** Public shape of the signed-in user. */
export interface CurrentUser {
  id: string;
  email: string;
  displayNameAr: string;
  roles: { role: string; departmentId?: string; implied?: boolean }[];
  departmentId?: string;
  employeeId?: string;
  status: (typeof ACCOUNT_STATUSES)[number];
  mfaEnabled: boolean;
  mfaRequired: boolean;
  /** Flattened permissions for the UI to hide what the API forbids (server still enforces). */
  permissions: { resource: string; actions: string[]; scope: string }[];
}
