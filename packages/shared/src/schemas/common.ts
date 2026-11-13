import { z } from 'zod';

export const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, 'معرّف غير صالح');
export const emailSchema = z.string().trim().toLowerCase().email('بريد إلكتروني غير صالح');
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?\d{9,15}$/, 'رقم جوال غير صالح');
export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاريخ غير صالح (YYYY-MM-DD)');
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(25),
});
export type Pagination = z.infer<typeof paginationSchema>;

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

/** A Riyadh calendar day, `YYYY-MM-DD` (list filters, dashboard drill-downs). */
export const riyadhDaySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'التاريخ بصيغة YYYY-MM-DD');
