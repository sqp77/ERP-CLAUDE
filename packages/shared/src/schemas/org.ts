import { z } from 'zod';
import { objectIdSchema } from './common';

/** Org structure [HR §3.1]. */
export const departmentSchema = z.object({
  code: z.string().trim().min(2).max(30).regex(/^[a-z0-9_]+$/, 'أحرف إنجليزية صغيرة وأرقام فقط'),
  nameAr: z.string().trim().min(2),
  nameEn: z.string().trim().optional(),
  parentId: objectIdSchema.nullable().optional(),
  managerUserId: objectIdSchema.nullable().optional(),
  active: z.boolean().default(true),
});
export const departmentUpdateSchema = departmentSchema.partial();

export const unitSchema = z.object({
  departmentId: objectIdSchema,
  nameAr: z.string().trim().min(2),
  active: z.boolean().default(true),
});
export const unitUpdateSchema = unitSchema.partial();

export const branchSchema = z.object({
  code: z.string().trim().min(2).max(30),
  nameAr: z.string().trim().min(2),
  region: z.string().trim().optional(),
  city: z.string().trim().optional(),
  address: z.string().trim().optional(),
  active: z.boolean().default(true),
});
export const branchUpdateSchema = branchSchema.partial();

/** Operating site with an optional geofence [HR §3.4 second]. Radius policy is a phase 2 setting (DECISIONS §7). */
export const siteSchema = z.object({
  branchId: objectIdSchema,
  nameAr: z.string().trim().min(2),
  location: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).nullable().optional(),
  geofenceRadiusM: z.number().int().positive().nullable().optional(),
  active: z.boolean().default(true),
});
export const siteUpdateSchema = siteSchema.partial();

export const positionSchema = z.object({
  code: z.string().trim().min(2).max(30),
  titleAr: z.string().trim().min(2),
  departmentId: objectIdSchema.nullable().optional(),
  grade: z.string().trim().optional(),
  descriptionAr: z.string().trim().optional(),
  active: z.boolean().default(true),
});
export const positionUpdateSchema = positionSchema.partial();

export const holidaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  nameAr: z.string().trim().min(2),
});
