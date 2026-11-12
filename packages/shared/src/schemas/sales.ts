import { z } from 'zod';
import { objectIdSchema, paginationSchema } from './common';

/** Opportunity stages [SAL §4.1 رابعاً] — verbatim labels; a lost opportunity needs a reason. */
export const OPPORTUNITY_STAGES = [
  'new',
  'in_progress',
  'contacted',
  'meeting_scheduled',
  'quote_sent',
  'negotiating',
  'won',
  'lost',
] as const;
export type OpportunityStage = (typeof OPPORTUNITY_STAGES)[number];
export const OPPORTUNITY_STAGE_AR: Record<OpportunityStage, string> = {
  new: 'جديدة',
  in_progress: 'قيد المعالجة',
  contacted: 'تم التواصل',
  meeting_scheduled: 'جدولة اجتماع',
  quote_sent: 'عرض سعر مرسل',
  negotiating: 'قيد التفاوض',
  won: 'ناجحة (تم إغلاق الصفقة)',
  lost: 'خاسرة (لم تتم الصفقة)',
};
export const OPEN_OPPORTUNITY_STAGES: readonly OpportunityStage[] = [
  'new',
  'in_progress',
  'contacted',
  'meeting_scheduled',
  'quote_sent',
  'negotiating',
];

/** The seven services [SAL §5]; requests arrive in S2, the key is used on opportunities from S1. */
export const SALES_SERVICE_TYPES = [
  'containerSale',
  'sortingContract',
  'cleaningContract',
  'destruction',
  'containerRental',
  'scrap',
  'assetReturn',
] as const;
export type SalesServiceType = (typeof SALES_SERVICE_TYPES)[number];
export const SALES_SERVICE_TYPE_AR: Record<SalesServiceType, string> = {
  containerSale: 'بيع الحاويات',
  sortingContract: 'الفرز (عقود الخدمات)',
  cleaningContract: 'عقد النظافة (النفايات العامة)',
  destruction: 'عقد الإتلاف',
  containerRental: 'تأجير الحاويات',
  scrap: 'السكراب (Scrap)',
  assetReturn: 'عقود رجيع الأصول (المناقصات)',
};

/** Provisional loss reasons and facility sizes (DECISIONS §20, Q7 pending): settings, editable by the admin. */
export const DEFAULT_LOSS_REASONS = ['السعر', 'المنافس', 'التوقيت', 'لا حاجة حالياً', 'أخرى (مع توضيح)'];
export const DEFAULT_FACILITY_SIZES = ['صغيرة', 'متوسطة', 'كبيرة'];

export const createOpportunitySchema = z.object({
  customerId: objectIdSchema,
  title: z.string().trim().min(2).max(200),
  serviceType: z.enum(SALES_SERVICE_TYPES).optional(),
  expectedValueHalalas: z.number().int().min(0).optional(),
  nextFollowUpAt: z.string().datetime({ offset: true }).optional(),
  attachmentIds: z.array(objectIdSchema).max(10).default([]),
  tags: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  /** Manager only: create for a rep. */
  ownerUserId: objectIdSchema.optional(),
  leadId: objectIdSchema.optional(),
});
export type CreateOpportunityInput = z.infer<typeof createOpportunitySchema>;

export const updateOpportunitySchema = z.object({
  title: z.string().trim().min(2).max(200).optional(),
  serviceType: z.enum(SALES_SERVICE_TYPES).nullable().optional(),
  expectedValueHalalas: z.number().int().min(0).nullable().optional(),
  nextFollowUpAt: z.string().datetime({ offset: true }).nullable().optional(),
  attachmentIds: z.array(objectIdSchema).max(10).optional(),
  tags: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
});

/** Stage move; `lostReason` is mandatory for خاسرة [SAL §4.1]. */
export const opportunityStageSchema = z
  .object({
    stage: z.enum(OPPORTUNITY_STAGES),
    lostReason: z.string().trim().max(120).optional(),
    lostNote: z.string().trim().max(2000).optional(),
    note: z.string().trim().max(2000).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.stage === 'lost' && !v.lostReason)
      ctx.addIssue({ code: 'custom', path: ['lostReason'], message: 'سبب خسارة الفرصة مطلوب' });
  });
export type OpportunityStageInput = z.infer<typeof opportunityStageSchema>;

export const reassignOpportunitiesSchema = z.object({
  opportunityIds: z.array(objectIdSchema).min(1).max(500),
  toUserId: objectIdSchema,
  reason: z.string().trim().min(2).max(500),
});

export const listOpportunitiesQuerySchema = paginationSchema.extend({
  stage: z.enum(OPPORTUNITY_STAGES).optional(),
  open: z.coerce.boolean().optional(),
  customerId: objectIdSchema.optional(),
  ownerUserId: objectIdSchema.optional(),
  serviceType: z.enum(SALES_SERVICE_TYPES).optional(),
  tag: z.string().trim().max(60).optional(),
  followUpDue: z.coerce.boolean().optional(),
  q: z.string().trim().max(120).optional(),
});

/** Tags (hashtags) [SAL §10.4]: scope = module; the department manager adds and edits them. */
export const tagSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .transform((s) => (s.startsWith('#') ? s : `#${s}`))
    .refine((s) => !/\s/.test(s), 'الوسم بلا مسافات (استخدم _)'),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
});
export const TAG_SCOPES = ['sales'] as const;
export const DEFAULT_SALES_TAGS = [
  '#عميل_جديد',
  '#عميل_استراتيجي',
  '#عقد_سنوي',
  '#تأجير_حاويات',
  '#سكراب',
  '#مناقصة',
  '#متابعة_مالية',
  '#يحتاج_زيارة',
];
