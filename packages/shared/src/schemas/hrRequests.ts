import { z } from 'zod';
import { objectIdSchema } from './common';

/** Self-service request types [HR §3.5]. */
export const HR_REQUEST_TYPES = [
  'leave',
  'permission',
  'remote_work',
  'salary_certificate',
  'experience_certificate',
  'advance',
  'data_update',
  'official_letter',
] as const;
export type HrRequestType = (typeof HR_REQUEST_TYPES)[number];
export const HR_REQUEST_TYPE_AR: Record<HrRequestType, string> = {
  leave: 'طلب إجازة',
  permission: 'طلب استئذان',
  remote_work: 'طلب عمل عن بُعد',
  salary_certificate: 'طلب تعريف بالراتب',
  experience_certificate: 'طلب شهادة خبرة',
  advance: 'طلب سلفة',
  data_update: 'طلب تحديث بيانات',
  official_letter: 'طلب خطاب رسمي',
};

/** Request states [HR §3.5 "حالات الطلب المقترحة"] — the workflow definition `hr_request` uses these codes. */
export const HR_REQUEST_STATE_AR: Record<string, string> = {
  new: 'جديد',
  under_review: 'قيد المراجعة',
  awaiting_manager: 'بانتظار موافقة المدير',
  awaiting_hr: 'بانتظار الموارد البشرية',
  awaiting_final: 'بانتظار الاعتماد النهائي',
  needs_completion: 'يحتاج استكمال',
  approved: 'معتمد',
  rejected: 'مرفوض',
  closed: 'مغلق',
};

export const LEAVE_TYPES = ['annual', 'sick', 'emergency', 'unpaid', 'maternity', 'hajj', 'other'] as const;
export const LEAVE_TYPE_AR: Record<(typeof LEAVE_TYPES)[number], string> = {
  annual: 'سنوية',
  sick: 'مرضية',
  emergency: 'اضطرارية',
  unpaid: 'بدون راتب',
  maternity: 'وضع',
  hajj: 'حج',
  other: 'أخرى',
};

const dateStr = z.coerce.date();
const timeStr = z.string().regex(/^\d{2}:\d{2}$/, 'الوقت بصيغة HH:MM');

/** Per-type fields exactly as HR §3.5 lists them. */
export const HR_REQUEST_DETAIL_SCHEMAS = {
  leave: z
    .object({
      leaveType: z.enum(LEAVE_TYPES),
      startDate: dateStr,
      endDate: dateStr,
      reason: z.string().trim().min(2).max(1000),
    })
    .refine((d) => d.endDate >= d.startDate, { message: 'تاريخ النهاية قبل البداية', path: ['endDate'] }),
  permission: z
    .object({
      date: dateStr,
      startTime: timeStr,
      endTime: timeStr,
      reason: z.string().trim().min(2).max(1000),
    })
    .refine((d) => d.endTime > d.startTime, { message: 'وقت النهاية قبل البداية', path: ['endTime'] }),
  remote_work: z.object({
    startDate: dateStr,
    days: z.number().int().min(1).max(60),
    reason: z.string().trim().min(2).max(1000),
  }),
  salary_certificate: z.object({
    addressedTo: z.string().trim().min(2).max(200),
    purpose: z.string().trim().min(2).max(500),
    detailed: z.boolean().default(false),
    chamberAttestation: z.boolean().default(false),
  }),
  experience_certificate: z.object({ purpose: z.string().trim().min(2).max(500) }),
  advance: z.object({
    amountHalalas: z.number().int().positive(),
    reason: z.string().trim().min(2).max(1000),
    notes: z.string().trim().max(1000).optional(),
  }),
  data_update: z.object({
    changes: z
      .array(
        z.object({
          field: z.string().trim().min(1).max(60),
          currentValue: z.string().trim().max(500).optional(),
          newValue: z.string().trim().min(1).max(500),
        }),
      )
      .min(1),
    reason: z.string().trim().max(1000).optional(),
  }),
  official_letter: z.object({
    letterType: z.string().trim().min(2).max(100),
    addressedTo: z.string().trim().min(2).max(200),
    purpose: z.string().trim().min(2).max(500),
  }),
} as const;

export const createHrRequestSchema = z.object({
  type: z.enum(HR_REQUEST_TYPES),
  details: z.record(z.unknown()),
  attachmentIds: z.array(objectIdSchema).default([]),
  notes: z.string().trim().max(1000).optional(),
});
export type CreateHrRequestInput = z.infer<typeof createHrRequestSchema>;

export const hrRequestTransitionSchema = z.object({
  transition: z.string().min(1),
  reason: z.string().trim().max(1000).optional(),
  /** Requester edits when resubmitting after "يحتاج استكمال". */
  details: z.record(z.unknown()).optional(),
  attachmentIds: z.array(objectIdSchema).optional(),
});

export const listHrRequestsQuerySchema = z.object({
  /** mine = my own; inbox = waiting for my action as direct manager; queue = HR/Finance work queue; all = everything I may see. */
  view: z.enum(['mine', 'inbox', 'queue', 'all']).default('mine'),
  type: z.enum(HR_REQUEST_TYPES).optional(),
  state: z.string().optional(),
  open: z.coerce.boolean().optional(),
  employeeId: objectIdSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(25),
});

/** Routing matrix (DECISIONS §5) — stored as the setting `hr.requestRoutes` so HR can change it. */
export interface HrRequestRoute {
  viaManager: boolean;
  finalApprover: 'hr' | 'hr_then_finance';
}
export const hrRequestRoutesSchema = z.record(
  z.enum(HR_REQUEST_TYPES),
  z.object({ viaManager: z.boolean(), finalApprover: z.enum(['hr', 'hr_then_finance']) }),
);
export const DEFAULT_HR_REQUEST_ROUTES: Record<HrRequestType, HrRequestRoute> = {
  leave: { viaManager: true, finalApprover: 'hr' },
  permission: { viaManager: true, finalApprover: 'hr' },
  remote_work: { viaManager: true, finalApprover: 'hr' },
  salary_certificate: { viaManager: false, finalApprover: 'hr' },
  experience_certificate: { viaManager: false, finalApprover: 'hr' },
  official_letter: { viaManager: false, finalApprover: 'hr' },
  data_update: { viaManager: false, finalApprover: 'hr' },
  advance: { viaManager: true, finalApprover: 'hr_then_finance' },
};
