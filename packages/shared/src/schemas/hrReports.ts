import { z } from 'zod';
import { objectIdSchema } from './common';

/** Employee reports to the direct manager [EP §14]. Types are a setting (`hr.reportTypes`); these are the defaults. */
export const DEFAULT_REPORT_TYPES = [
  { code: 'daily', labelAr: 'تقرير يومي' },
  { code: 'weekly', labelAr: 'تقرير أسبوعي' },
  { code: 'monthly', labelAr: 'تقرير شهري' },
  { code: 'visit', labelAr: 'تقرير زيارة' },
  { code: 'task', labelAr: 'تقرير مهمة' },
  { code: 'secondment', labelAr: 'تقرير انتداب' },
  { code: 'other', labelAr: 'أخرى' },
] as const;
export const reportTypesSchema = z
  .array(z.object({ code: z.string().regex(/^[a-z_]{2,30}$/), labelAr: z.string().min(1) }))
  .min(1);

export const REPORT_STATES = ['submitted', 'reviewed'] as const;
export type ReportState = (typeof REPORT_STATES)[number];

export const createEmployeeReportSchema = z
  .object({
    type: z.string().min(1),
    title: z.string().trim().min(2).max(200),
    periodFrom: z.coerce.date().nullable().optional(),
    periodTo: z.coerce.date().nullable().optional(),
    body: z.string().trim().min(2).max(20000),
    attachmentIds: z.array(objectIdSchema).default([]),
    /** When the report answers a manager's request. */
    requestId: objectIdSchema.optional(),
  })
  .refine((r) => !r.periodFrom || !r.periodTo || r.periodTo >= r.periodFrom, {
    message: 'نهاية الفترة قبل بدايتها',
    path: ['periodTo'],
  });
export type CreateEmployeeReportInput = z.infer<typeof createEmployeeReportSchema>;

export const reportNoteSchema = z.object({ note: z.string().trim().min(1).max(5000) });
export const requestReportSchema = z.object({
  employeeUserId: objectIdSchema,
  type: z.string().min(1),
  dueDate: z.coerce.date().optional(),
  note: z.string().trim().max(1000).optional(),
});
export const listEmployeeReportsQuerySchema = z.object({
  view: z.enum(['mine', 'team', 'all']).default('mine'),
  employeeId: objectIdSchema.optional(),
  type: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(25),
});
