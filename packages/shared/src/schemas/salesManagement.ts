import { z } from 'zod';
import { objectIdSchema, paginationSchema, riyadhDaySchema } from './common';
import { SALES_SERVICE_TYPES } from './sales';

/**
 * Sales S4 — management and follow-up [SAL §17 المرحلة الرابعة]: targets with versions (§11.1), the KPI board
 * (§11, §11.2), the Sales dashboard (§13), department discussions (§10.3) and the Sales documents library (§8.2).
 */

/** A month in Riyadh time, `YYYY-MM`. */
export const periodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'الفترة بصيغة YYYY-MM');

// ------------------------------------------------------------------------------------------------
// Targets — every edit or withdrawal is a new version [SAL §11.1]
// ------------------------------------------------------------------------------------------------
export const SALES_TARGET_SCOPES = ['department', 'user'] as const;
export type SalesTargetScope = (typeof SALES_TARGET_SCOPES)[number];
/** «توزيع المستهدف حسب نوع الخدمة أو المادة» [SAL §11.1]. */
export const SALES_TARGET_DIMENSIONS = ['none', 'service', 'material'] as const;
export type SalesTargetDimension = (typeof SALES_TARGET_DIMENSIONS)[number];
/** Revenue in halalas, or a quantity in kilograms (tons are a display unit — CLAUDE.md "weights as integer kg"). */
export const SALES_TARGET_METRICS = ['revenue', 'quantity'] as const;
export type SalesTargetMetric = (typeof SALES_TARGET_METRICS)[number];
export const SALES_TARGET_METRIC_AR: Record<SalesTargetMetric, string> = {
  revenue: 'المبيعات (ريال)',
  quantity: 'الكمية (طن)',
};
export const SALES_TARGET_DIMENSION_AR: Record<SalesTargetDimension, string> = {
  none: 'إجمالي',
  service: 'حسب نوع الخدمة',
  material: 'حسب المادة',
};

export const setSalesTargetSchema = z
  .object({
    period: periodSchema,
    scope: z.enum(SALES_TARGET_SCOPES),
    userId: objectIdSchema.optional(),
    dimension: z.enum(SALES_TARGET_DIMENSIONS).default('none'),
    /** Service type for `service`, price-list item id for `material`. */
    dimensionKey: z.string().trim().max(60).optional(),
    metric: z.enum(SALES_TARGET_METRICS).default('revenue'),
    /** Halalas for revenue, kilograms for quantity. */
    value: z.number().int().min(0).max(1_000_000_000_000),
    /** Required by the server when the target already has a version [SAL §11.1 «سبب التعديل»]. */
    reason: z.string().trim().max(1000).optional(),
  })
  .refine((t) => t.scope === 'department' || !!t.userId, { message: 'اختر الموظف', path: ['userId'] })
  .refine((t) => t.dimension === 'none' || !!t.dimensionKey, {
    message: 'اختر نوع الخدمة أو المادة',
    path: ['dimensionKey'],
  })
  .refine(
    (t) =>
      t.dimension !== 'service' || (SALES_SERVICE_TYPES as readonly string[]).includes(t.dimensionKey ?? ''),
    {
      message: 'نوع خدمة غير معروف',
      path: ['dimensionKey'],
    },
  )
  .refine((t) => t.dimension !== 'material' || objectIdSchema.safeParse(t.dimensionKey).success, {
    message: 'اختر مادة من قائمة الأسعار',
    path: ['dimensionKey'],
  });
export type SetSalesTargetInput = z.infer<typeof setSalesTargetSchema>;

export const withdrawSalesTargetSchema = z.object({
  reason: z.string().trim().min(3, 'سبب السحب مطلوب').max(1000),
});

export const listSalesTargetsQuerySchema = z.object({
  period: periodSchema.optional(),
  /** Compare several months [SAL §11.1 «مقارنة أداء الموظفين بين الأشهر»]: `from`..`to` inclusive. */
  from: periodSchema.optional(),
  to: periodSchema.optional(),
  userId: objectIdSchema.optional(),
});

// ------------------------------------------------------------------------------------------------
// KPIs [SAL §11, §11.2] and the dashboard [SAL §13]
// ------------------------------------------------------------------------------------------------
export const SALES_KPI_CODES = [
  'sales.revenue',
  'sales.tons_sold',
  'sales.quote_conversion',
  'sales.avg_price_per_ton',
  'sales.avg_collection_days',
] as const;
export type SalesKpiCode = (typeof SALES_KPI_CODES)[number];
export const SALES_KPI_AR: Record<SalesKpiCode, string> = {
  'sales.revenue': 'إجمالي الإيرادات',
  'sales.tons_sold': 'الكمية المباعة',
  'sales.quote_conversion': 'نسبة تحويل العروض',
  'sales.avg_price_per_ton': 'متوسط سعر الطن',
  'sales.avg_collection_days': 'متوسط مدة التحصيل',
};
/** Core KPI status: below / achieved / exceeded (CLAUDE.md "KPI framework"). */
export const KPI_STATUSES = ['below', 'achieved', 'exceeded', 'no_target', 'no_data'] as const;
export type KpiStatus = (typeof KPI_STATUSES)[number];
export const KPI_STATUS_AR: Record<KpiStatus, string> = {
  below: 'أقل من المستهدف',
  achieved: 'تحقق',
  exceeded: 'تجاوز المستهدف',
  no_target: 'لا يوجد مستهدف',
  no_data: 'لا توجد بيانات',
};

export const salesKpiQuerySchema = z.object({
  period: periodSchema.optional(),
  userId: objectIdSchema.optional(),
  serviceType: z.enum(SALES_SERVICE_TYPES).optional(),
});
export type SalesKpiQuery = z.infer<typeof salesKpiQuerySchema>;

export const salesDashboardQuerySchema = z.object({
  period: periodSchema.optional(),
});

// ------------------------------------------------------------------------------------------------
// Department discussions [SAL §10.3] — core capability, any record type the caller may access
// ------------------------------------------------------------------------------------------------
export const DISCUSSION_STATES = ['new', 'in_progress', 'awaiting_reply', 'resolved', 'closed'] as const;
export type DiscussionState = (typeof DISCUSSION_STATES)[number];
/** Verbatim SAL §10.3 «جديدة، قيد المعالجة، بانتظار الرد، تم الحل، مغلقة». */
export const DISCUSSION_STATE_AR: Record<DiscussionState, string> = {
  new: 'جديدة',
  in_progress: 'قيد المعالجة',
  awaiting_reply: 'بانتظار الرد',
  resolved: 'تم الحل',
  closed: 'مغلقة',
};
export const createDiscussionSchema = z.object({
  recordType: z.string().trim().min(1).max(40),
  recordId: z.string().trim().min(1).max(60),
  title: z.string().trim().min(3).max(200),
  details: z.string().trim().min(3).max(5000),
  targetDepartmentId: objectIdSchema,
  participantUserIds: z.array(objectIdSchema).max(20).default([]),
  attachmentIds: z.array(objectIdSchema).max(20).default([]),
});
export type CreateDiscussionInput = z.infer<typeof createDiscussionSchema>;
export const discussionMessageSchema = z.object({
  body: z.string().trim().min(1).max(5000),
  attachmentIds: z.array(objectIdSchema).max(20).default([]),
});
export const discussionStateSchema = z.object({
  state: z.enum(DISCUSSION_STATES),
  note: z.string().trim().max(2000).optional(),
});
export const discussionParticipantsSchema = z.object({
  userIds: z.array(objectIdSchema).min(1).max(20),
});
export const listDiscussionsQuerySchema = paginationSchema.extend({
  /** mine = opened by me or I take part; department = to or from my department. */
  view: z.enum(['mine', 'department']).default('mine'),
  state: z.enum(DISCUSSION_STATES).optional(),
  open: z.coerce.boolean().optional(),
  recordType: z.string().trim().max(40).optional(),
  recordId: z.string().trim().max(60).optional(),
});

// ------------------------------------------------------------------------------------------------
// Sales documents library [SAL §8.2 «رفع إجراءات العمل والتعليمات بصيغة PDF»]
// ------------------------------------------------------------------------------------------------
export const SALES_LIBRARY_CATEGORIES = ['procedure', 'instruction', 'other'] as const;
export type SalesLibraryCategory = (typeof SALES_LIBRARY_CATEGORIES)[number];
export const SALES_LIBRARY_CATEGORY_AR: Record<SalesLibraryCategory, string> = {
  procedure: 'إجراءات العمل',
  instruction: 'التعليمات',
  other: 'أخرى',
};
export const createLibraryDocSchema = z.object({
  title: z.string().trim().min(3).max(200),
  category: z.enum(SALES_LIBRARY_CATEGORIES),
  description: z.string().trim().max(2000).optional(),
  attachmentId: objectIdSchema,
  /** Upload a new version of an existing document; the old one stays in the history. */
  replacesId: objectIdSchema.optional(),
});
export type CreateLibraryDocInput = z.infer<typeof createLibraryDocSchema>;

// ------------------------------------------------------------------------------------------------
// Reports [SAL §12]: five groups on the core export builder (field picker, preview, Excel, PDF)
// ------------------------------------------------------------------------------------------------
export const SALES_REPORT_GROUPS = ['sales', 'customers', 'opportunities', 'employees', 'financial'] as const;
export type SalesReportGroup = (typeof SALES_REPORT_GROUPS)[number];
export const SALES_REPORT_GROUP_AR: Record<SalesReportGroup, string> = {
  sales: 'تقارير المبيعات',
  customers: 'تقارير العملاء',
  opportunities: 'تقارير الفرص البيعية',
  employees: 'تقارير الموظفين',
  financial: 'التقارير المالية',
};
/** Each report is an export resource `sales.report.<code>`; `segments` are the report's own variants. */
export const SALES_REPORTS: {
  code: string;
  group: SalesReportGroup;
  segments?: readonly string[];
  granularity?: boolean;
}[] = [
  { code: 'sales_by_period', group: 'sales', granularity: true },
  { code: 'revenue_by_material', group: 'sales' },
  { code: 'revenue_by_service', group: 'sales' },
  { code: 'quantities', group: 'sales' },
  { code: 'avg_prices', group: 'sales' },
  { code: 'customers', group: 'customers', segments: ['all', 'new', 'active', 'not_cooperating'] },
  { code: 'customers_by_classification', group: 'customers' },
  { code: 'opportunities', group: 'opportunities', segments: ['new', 'in_progress', 'won', 'lost'] },
  { code: 'quotes', group: 'opportunities', segments: ['sent', 'accepted', 'rejected'] },
  { code: 'loss_reasons', group: 'opportunities' },
  { code: 'employees', group: 'employees' },
  { code: 'invoices', group: 'financial', segments: ['all', 'paid', 'unpaid', 'overdue'] },
  { code: 'financial_summary', group: 'financial' },
];
export const SALES_REPORT_GRANULARITIES = ['day', 'week', 'month'] as const;
/** «تحديد الفترة الزمنية، اختيار القسم أو الموظف، اختيار نوع الخدمة، تطبيق الفلاتر» [SAL §12 متطلبات التصدير]. */
export const salesReportFiltersSchema = z.object({
  from: riyadhDaySchema.optional(),
  to: riyadhDaySchema.optional(),
  ownerUserId: objectIdSchema.optional(),
  serviceType: z.enum(SALES_SERVICE_TYPES).optional(),
  granularity: z.enum(SALES_REPORT_GRANULARITIES).optional(),
  segment: z.string().trim().max(40).optional(),
  classification: z.string().trim().max(40).optional(),
});
export type SalesReportFilters = z.infer<typeof salesReportFiltersSchema>;
