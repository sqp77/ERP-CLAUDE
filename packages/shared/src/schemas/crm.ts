import { z } from 'zod';
import { emailSchema, objectIdSchema, paginationSchema, phoneSchema, riyadhDaySchema } from './common';

/**
 * CRM core shared by Sales, Customer Service, Operations and Sustainability [SAL §4.1, §19; CS §6.2–6.3, §6.8].
 * Arabic labels are the spec's words, verbatim.
 */
export const CUSTOMER_KINDS = ['organization', 'individual'] as const;
export type CustomerKind = (typeof CUSTOMER_KINDS)[number];

/** حالة العميل [SAL §4.1 رابعاً] — separate from the opportunity stage. */
export const CUSTOMER_STATUSES = ['active', 'potential', 'not_interested', 'cooperating', 'stopped'] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];
export const CUSTOMER_STATUS_AR: Record<CustomerStatus, string> = {
  active: 'عميل نشط',
  potential: 'عميل محتمل',
  not_interested: 'عميل غير مهتم',
  cooperating: 'عميل متعاون',
  stopped: 'عميل متوقف عن التعامل',
};

/** مصادر العملاء [SAL §4.1]. */
export const CUSTOMER_SOURCES = [
  'social_media',
  'field_visits',
  'referrals',
  'customer_service',
  'direct_contact',
  'exhibitions',
  'other',
] as const;
export type CustomerSource = (typeof CUSTOMER_SOURCES)[number];
export const CUSTOMER_SOURCE_AR: Record<CustomerSource, string> = {
  social_media: 'وسائل التواصل الاجتماعي',
  field_visits: 'الزيارات الميدانية',
  referrals: 'الترشيحات',
  customer_service: 'خدمة العملاء',
  direct_contact: 'الاتصالات المباشرة',
  exhibitions: 'المعارض والمؤتمرات',
  other: 'مصادر أخرى',
};

/** تصنيف العملاء حسب الأهمية [SAL §12] — set by the Sales manager by hand (DECISIONS §20 Q9). */
export const CUSTOMER_CLASSIFICATIONS = ['strategic', 'regular', 'occasional'] as const;
export type CustomerClassification = (typeof CUSTOMER_CLASSIFICATIONS)[number];
export const CUSTOMER_CLASSIFICATION_AR: Record<CustomerClassification, string> = {
  strategic: 'استراتيجي',
  regular: 'منتظم',
  occasional: 'عرضي',
};

/** وسيلة التواصل in the communication log [SAL §4.1 ثالثاً]. */
export const COMMUNICATION_METHODS = ['call', 'email', 'visit', 'meeting'] as const;
export type CommunicationMethod = (typeof COMMUNICATION_METHODS)[number];
export const COMMUNICATION_METHOD_AR: Record<CommunicationMethod, string> = {
  call: 'اتصال',
  email: 'بريد إلكتروني',
  visit: 'زيارة',
  meeting: 'اجتماع',
};

/** Lead states, CS §6.8 verbatim. */
export const LEAD_STATES = [
  'new',
  'contacted',
  'referred',
  'following_up',
  'opportunity',
  'converted',
  'not_interested',
  'closed',
] as const;
export type LeadState = (typeof LEAD_STATES)[number];
export const LEAD_STATE_AR: Record<LeadState, string> = {
  new: 'جديد',
  contacted: 'تم التواصل',
  referred: 'محال للقسم المختص',
  following_up: 'قيد المتابعة',
  opportunity: 'فرصة قائمة',
  converted: 'تم تحويله إلى عميل',
  not_interested: 'غير مهتم',
  closed: 'مغلق',
};
export const OPEN_LEAD_STATES: readonly LeadState[] = [
  'new',
  'contacted',
  'referred',
  'following_up',
  'opportunity',
];
export const LEAD_TARGET_DEPARTMENTS = ['sales', 'sustainability'] as const;

/** Initial organization types [SAL §4.1 «حكومي، خاص، عام»; DECISIONS §20 Q8]. Configurable (`crm.organizationTypes`). */
export const DEFAULT_ORGANIZATION_TYPES = ['حكومي', 'خاص', 'عام'];

/** At most three contact persons per organization [SAL §4.1 ثانياً]. */
export const MAX_CONTACTS_PER_CUSTOMER = 3;

export const contactInputSchema = z.object({
  nameAr: z.string().trim().min(2).max(120),
  jobTitle: z.string().trim().max(120).optional(),
  phone: phoneSchema.optional(),
  email: emailSchema.optional(),
  notes: z.string().trim().max(2000).optional(),
});
export type ContactInput = z.infer<typeof contactInputSchema>;

const customerCore = {
  kind: z.enum(CUSTOMER_KINDS).default('organization'),
  nameAr: z.string().trim().min(2).max(200),
  country: z.string().trim().max(80).optional(),
  region: z.string().trim().max(80).optional(),
  city: z.string().trim().max(80).optional(),
  activity: z.string().trim().max(200).optional(),
  organizationType: z.string().trim().max(80).optional(),
  facilitySize: z.string().trim().max(80).optional(),
  source: z.enum(CUSTOMER_SOURCES),
  sourceNote: z.string().trim().max(500).optional(),
  status: z.enum(CUSTOMER_STATUSES).default('potential'),
  phone: phoneSchema.optional(),
  email: emailSchema.optional(),
  /** Party master fields for organizations (FIN §8): CR / unified number drive duplicate prevention. */
  crNumber: z
    .string()
    .trim()
    .regex(/^\d{10}$/, 'رقم السجل التجاري 10 أرقام')
    .optional(),
  unifiedNumber: z
    .string()
    .trim()
    .regex(/^7\d{9}$/, 'الرقم الموحد يبدأ بـ 7 ويتكون من 10 أرقام')
    .optional(),
  vatNumber: z
    .string()
    .trim()
    .regex(/^3\d{14}$/, 'الرقم الضريبي 15 رقمًا يبدأ بـ 3')
    .optional(),
  nationalAddress: z.string().trim().max(300).optional(),
  notes: z.string().trim().max(2000).optional(),
  tags: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  /** When the referral came from Customer Service [SAL §3, §8.1]. */
  leadId: objectIdSchema.optional(),
};

/** «عميل جديد / فرصة بيعية جديدة»: a customer, up to 3 contacts, and optionally the first opportunity. */
export const createCustomerSchema = z.object({
  ...customerCore,
  contacts: z.array(contactInputSchema).max(MAX_CONTACTS_PER_CUSTOMER).default([]),
  /** Manager only: register on behalf of a rep [SAL §8.1]. */
  ownerUserId: objectIdSchema.optional(),
  opportunity: z
    .object({
      title: z.string().trim().min(2).max(200),
      serviceType: z.string().trim().max(40).optional(),
      expectedValueHalalas: z.number().int().min(0).optional(),
      nextFollowUpAt: z.string().datetime({ offset: true }).optional(),
    })
    .optional(),
  /** Set when the duplicate warning (same normalized name) was shown and the manager confirmed anyway. */
  confirmDuplicateName: z.boolean().optional(),
});
export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;

export const updateCustomerSchema = z
  .object({ ...customerCore })
  .partial()
  .extend({ classification: z.enum(CUSTOMER_CLASSIFICATIONS).nullable().optional() });
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;

export const duplicateCheckSchema = z.object({
  nameAr: z.string().trim().min(2).max(200).optional(),
  phone: phoneSchema.optional(),
  crNumber: z.string().trim().optional(),
  unifiedNumber: z.string().trim().optional(),
  excludeId: objectIdSchema.optional(),
});

export const listCustomersQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(120).optional(),
  status: z.enum(CUSTOMER_STATUSES).optional(),
  source: z.enum(CUSTOMER_SOURCES).optional(),
  classification: z.enum(CUSTOMER_CLASSIFICATIONS).optional(),
  ownerUserId: objectIdSchema.optional(),
  tag: z.string().trim().max(60).optional(),
  /** Customers whose next follow-up date has passed [SAL §13 ثانياً]. */
  followUpDue: z.coerce.boolean().optional(),
  referredFromCs: z.coerce.boolean().optional(),
  /** Created between two Riyadh days, inclusive (dashboard «العملاء الجدد» drill-down, SAL §13). */
  createdFrom: riyadhDaySchema.optional(),
  createdTo: riyadhDaySchema.optional(),
  sort: z.enum(['recent', 'name', 'followUp', 'lastContact']).default('recent'),
});

/** سجل التواصل: append-only [SAL §4.1 ثالثاً, §10.2, §19]. */
export const createCommunicationLogSchema = z.object({
  method: z.enum(COMMUNICATION_METHODS),
  details: z.string().trim().min(1).max(5000),
  outcome: z.string().trim().max(2000).optional(),
  customerNeed: z.string().trim().max(2000).optional(),
  nextStep: z.string().trim().max(2000).optional(),
  nextFollowUpAt: z.string().datetime({ offset: true }).optional(),
  attachmentIds: z.array(objectIdSchema).max(10).default([]),
  opportunityId: objectIdSchema.optional(),
});
export type CreateCommunicationLogInput = z.infer<typeof createCommunicationLogSchema>;

/** نقل العميل من موظف إلى موظف آخر, one or many [SAL §8.1, §14]. */
export const transferCustomersSchema = z.object({
  customerIds: z.array(objectIdSchema).min(1).max(500),
  toUserId: objectIdSchema,
  reason: z.string().trim().min(2).max(500),
  /** Also move the customers' open opportunities to the new owner (default true). */
  includeOpportunities: z.boolean().default(true),
});
export type TransferCustomersInput = z.infer<typeof transferCustomersSchema>;

/** «إحالة عميل محتمل إلى المبيعات» — Customer Service form [SAL §3, CS §6.8]. */
export const createLeadSchema = z.object({
  customerName: z.string().trim().min(2).max(200),
  contactName: z.string().trim().max(120).optional(),
  phone: phoneSchema.optional(),
  email: emailSchema.optional(),
  interest: z.string().trim().min(2).max(500),
  channel: z.string().trim().max(60).optional(),
  notes: z.string().trim().max(2000).optional(),
  targetDepartment: z.enum(LEAD_TARGET_DEPARTMENTS).default('sales'),
  attachmentIds: z.array(objectIdSchema).max(10).default([]),
  /** When the lead is about an existing customer. */
  customerId: objectIdSchema.optional(),
});
export type CreateLeadInput = z.infer<typeof createLeadSchema>;

export const assignLeadSchema = z.object({ assigneeUserId: objectIdSchema });
export const leadStateSchema = z.object({
  state: z.enum(LEAD_STATES),
  outcome: z.string().trim().max(2000).optional(),
});
export const convertLeadSchema = z.object({
  /** Link to an existing customer, or create one from the lead data. */
  customerId: objectIdSchema.optional(),
  createOpportunity: z.boolean().default(true),
  opportunityTitle: z.string().trim().max(200).optional(),
  expectedValueHalalas: z.number().int().min(0).optional(),
});
export const listLeadsQuerySchema = paginationSchema.extend({
  state: z.enum(LEAD_STATES).optional(),
  open: z.coerce.boolean().optional(),
  overdue: z.coerce.boolean().optional(),
  assigneeUserId: objectIdSchema.optional(),
  targetDepartment: z.enum(LEAD_TARGET_DEPARTMENTS).optional(),
  view: z.enum(['mine', 'department', 'referred']).optional(),
});
