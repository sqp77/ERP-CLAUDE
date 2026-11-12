import { z } from 'zod';
import { objectIdSchema, paginationSchema, phoneSchema } from './common';
import { SALES_SERVICE_TYPES, type SalesServiceType } from './sales';

/**
 * Sales service requests [SAL §5, §6]: one collection, a discriminator per service, a workflow definition per
 * service (`sales_request_<type>`), the same record and number through Procurement, Finance and Operations
 * (CLAUDE.md golden rule 6). Arabic labels are the spec's words verbatim; Operations states are OPS §2.1 verbatim
 * (DECISIONS §20 change 5), the Finance completion state is PRC §4 (change 4).
 */

/** Departments that may hold a Sales request at some stage. */
export const REQUEST_HOLDERS = ['sales', 'procurement', 'finance', 'ops'] as const;
export type RequestHolder = (typeof REQUEST_HOLDERS)[number];
export const REQUEST_HOLDER_AR: Record<RequestHolder, string> = {
  sales: 'المبيعات',
  procurement: 'المشتريات',
  finance: 'المالية',
  ops: 'التشغيل والمشاريع',
};

/** Every state any service route can use; each workflow definition picks its own subset. */
export const SALES_REQUEST_STATE_AR: Record<string, string> = {
  // Sales
  new: 'جديد',
  quoting: 'إعداد عرض السعر',
  quote_sent: 'عرض سعر مرسل',
  negotiating: 'قيد التفاوض',
  customer_approved: 'تمت موافقة العميل',
  contracting: 'التعاقد',
  // Procurement [SAL §6.1 المرحلة الثانية والرابعة]
  at_procurement: 'لدى المشتريات',
  execution_started: 'بدأ التنفيذ',
  execution_in_progress: 'قيد المعالجة',
  execution_rejected: 'تم الرفض',
  execution_cancelled: 'تم الإلغاء',
  execution_done: 'تم الإنجاز',
  // Finance [SAL §6.1 المرحلة الثالثة, PRC §4]
  at_finance: 'بانتظار اعتماد المالية',
  finance_needs_info: 'يحتاج استكمال بيانات',
  finance_rejected: 'مرفوض',
  // Operations [OPS §2.1 verbatim]
  ops_new: 'جديد',
  ops_review: 'قيد المراجعة',
  ops_scheduled: 'مجدول',
  ops_in_progress: 'قيد التنفيذ',
  ops_completed: 'مكتمل',
  ops_postponed: 'مؤجل',
  ops_cancelled: 'ملغي',
  ops_rejected: 'مرفوض',
  // Scrap [SAL §5.6, OPS §2.2]
  assessed: 'تم التقييم',
  price_agreed: 'تم الاتفاق على السعر',
  pickup_scheduled: 'تمت جدولة السحب',
  collected: 'تم الاستلام',
  transferred: 'تم التحويل',
  // Asset return [SAL §5.7]
  under_study: 'قيد الدراسة',
  cooperated: 'تم التعاون',
  not_cooperated: 'لم يتم التعاون',
  // Closing [SAL §6.2]
  closed_success: 'تم الإغلاق بنجاح',
  closed_incomplete: 'تم الإغلاق دون استكمال',
  suspended: 'تم إيقاف المشروع',
  cancelled: 'تم إلغاء المشروع',
};

/** Which department holds the record in each state (drives the queues «الطلبات الواردة من المبيعات»). */
export const STATE_HOLDER: Record<string, RequestHolder> = {
  new: 'sales',
  quoting: 'sales',
  quote_sent: 'sales',
  negotiating: 'sales',
  customer_approved: 'sales',
  contracting: 'sales',
  at_procurement: 'procurement',
  execution_started: 'procurement',
  execution_in_progress: 'procurement',
  execution_rejected: 'sales',
  execution_cancelled: 'sales',
  execution_done: 'procurement',
  at_finance: 'finance',
  finance_needs_info: 'sales',
  finance_rejected: 'sales',
  ops_new: 'ops',
  ops_review: 'ops',
  ops_scheduled: 'ops',
  ops_in_progress: 'ops',
  ops_completed: 'sales',
  ops_postponed: 'ops',
  ops_cancelled: 'sales',
  ops_rejected: 'sales',
  assessed: 'sales',
  price_agreed: 'ops',
  pickup_scheduled: 'ops',
  collected: 'sales',
  transferred: 'sales',
  under_study: 'sales',
  cooperated: 'sales',
  not_cooperated: 'sales',
  closed_success: 'sales',
  closed_incomplete: 'sales',
  suspended: 'sales',
  cancelled: 'sales',
};

export const CLOSING_STATES = ['closed_success', 'closed_incomplete', 'suspended', 'cancelled'] as const;
export const FINAL_STATES = [...CLOSING_STATES, 'cooperated', 'not_cooperated'] as const;

/** Closing transitions [SAL §6.2]; «تم الإغلاق بنجاح» notifies Operations. */
export const CLOSING_TRANSITIONS: Record<string, string> = {
  close_success: 'closed_success',
  close_incomplete: 'closed_incomplete',
  suspend: 'suspended',
  cancel: 'cancelled',
};

export const RENTAL_INSPECTION_PHASES = ['before_delivery', 'after_delivery', 'after_pickup'] as const;
export type RentalInspectionPhase = (typeof RENTAL_INSPECTION_PHASES)[number];
export const RENTAL_INSPECTION_PHASE_AR: Record<RentalInspectionPhase, string> = {
  before_delivery: 'نموذج قبل التسليم',
  after_delivery: 'نموذج بعد التسليم',
  after_pickup: 'نموذج بعد السحب',
};
export const DELIVERY_ZONES = ['inside_eastern', 'outside_eastern'] as const;
export const DELIVERY_ZONE_AR: Record<(typeof DELIVERY_ZONES)[number], string> = {
  inside_eastern: 'داخل المنطقة الشرقية',
  outside_eastern: 'خارجها',
};
export const CLEANING_MODES = ['provide_container', 'direct_collection'] as const;
export const CLEANING_MODE_AR: Record<(typeof CLEANING_MODES)[number], string> = {
  provide_container: 'توفير حاوية',
  direct_collection: 'جمع مباشر',
};
export const SCRAP_TRANSFER_STATUSES = ['transferred', 'not_transferred'] as const;
export const SCRAP_TRANSFER_STATUS_AR: Record<(typeof SCRAP_TRANSFER_STATUSES)[number], string> = {
  transferred: 'تم التحويل',
  not_transferred: 'لم يتم التحويل',
};
export const SCRAP_TASK_STATUS_AR = { done: 'تمت', not_done: 'لم تتم' } as const;

const money = z.number().int().min(0);
const kg = z.number().int().min(0);
const text = (max = 2000) => z.string().trim().max(max);
const dateStr = z.string().datetime({ offset: true });

/** Per-service field sets, verbatim from SAL §5.1–§5.7 (the customer, owner and attachments are common). */
export const containerSaleDetailsSchema = z.object({
  region: text(80).optional(),
  containerType: text(80).optional(),
  size: text(80).optional(),
  count: z.number().int().min(1),
  color: text(40).optional(),
  dimensions: text(120).optional(),
  requestDate: dateStr.optional(),
  agreedPriceHalalas: money.optional(),
  notes: text().optional(),
});
export const sortingContractDetailsSchema = z.object({
  contractType: text(80).optional(),
  materialTypes: z.array(text(80)).default([]),
  expectedQuantityKg: kg.optional(),
  customerLocation: text(500).optional(),
  contractDurationMonths: z.number().int().min(1).optional(),
  pickupSchedule: text(500).optional(),
  notes: text().optional(),
});
export const cleaningContractDetailsSchema = z.object({
  serviceLocation: text(500).optional(),
  wasteType: text(80).optional(),
  serviceType: text(80).optional(),
  mode: z.enum(CLEANING_MODES),
  containerCount: z.number().int().min(0).optional(),
  visitCount: z.number().int().min(0).optional(),
  contractDurationMonths: z.number().int().min(1).optional(),
  contractStart: dateStr.optional(),
  contractEnd: dateStr.optional(),
});
export const destructionDetailsSchema = z.object({
  contactPersonName: text(120).optional(),
  contactPhone: phoneSchema.optional(),
  customerLocation: text(500).optional(),
  materialType: text(80).optional(),
  estimatedQuantityKg: kg.optional(),
  notes: text().optional(),
});
export const containerRentalDetailsSchema = z.object({
  contactPhone: phoneSchema.optional(),
  address: text(500).optional(),
  region: text(80).optional(),
  containerSize: text(80).optional(),
  containerCount: z.number().int().min(1),
  color: text(40).optional(),
  dimensions: text(120).optional(),
  deliveryZone: z.enum(DELIVERY_ZONES),
  requestDate: dateStr.optional(),
  requestedDeliveryDate: dateStr.optional(),
  rentalDurationDays: z.number().int().min(1).optional(),
  containerResponsibleUserId: objectIdSchema.optional(),
  containerNumbers: z.array(text(40)).default([]),
  agreedPriceHalalas: money.optional(),
  notes: text().optional(),
});
export const scrapDetailsSchema = z.object({
  region: text(80).optional(),
  materialType: text(80).optional(),
  mobile: phoneSchema.optional(),
  address: text(500).optional(),
  contactPersonName: text(120).optional(),
  materialDescription: text().optional(),
  estimatedQuantityKg: kg.optional(),
  proposedPriceHalalas: money.optional(),
  agreedPriceHalalas: money.optional(),
  followUpUserId: objectIdSchema.optional(),
});
export const assetReturnDetailsSchema = z.object({
  region: text(80).optional(),
  facilitySize: text(80).optional(),
  tenderSource: text(80).optional(),
  tenderInfo: text().optional(),
  assetType: text(120).optional(),
  opportunityDate: dateStr.optional(),
  lastContactAt: dateStr.optional(),
  nextConversationAt: dateStr.optional(),
});
export const DETAILS_SCHEMAS: Record<SalesServiceType, z.ZodTypeAny> = {
  containerSale: containerSaleDetailsSchema,
  sortingContract: sortingContractDetailsSchema,
  cleaningContract: cleaningContractDetailsSchema,
  destruction: destructionDetailsSchema,
  containerRental: containerRentalDetailsSchema,
  scrap: scrapDetailsSchema,
  assetReturn: assetReturnDetailsSchema,
};

export const createSalesRequestSchema = z.object({
  type: z.enum(SALES_SERVICE_TYPES),
  customerId: objectIdSchema,
  opportunityId: objectIdSchema.optional(),
  title: text(200).optional(),
  details: z.record(z.string(), z.unknown()),
  attachmentIds: z.array(objectIdSchema).max(20).default([]),
  /** Photos of the material [SAL §5.4 «صور المواد», §5.6 «المرفقات والصور»]. */
  photoIds: z.array(objectIdSchema).max(30).default([]),
  tags: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  ownerUserId: objectIdSchema.optional(),
  /** Container sale: supply / manufacturing / outside supplier needed → Procurement (default true for CSR). */
  needsProcurement: z.boolean().optional(),
  /** Sorting / cleaning: Finance approval needed before Operations («عند الحاجة»). */
  needsFinanceApproval: z.boolean().optional(),
  needsOperations: z.boolean().optional(),
});
export type CreateSalesRequestInput = z.infer<typeof createSalesRequestSchema>;

export const updateSalesRequestSchema = z.object({
  title: text(200).optional(),
  details: z.record(z.string(), z.unknown()).optional(),
  attachmentIds: z.array(objectIdSchema).max(20).optional(),
  photoIds: z.array(objectIdSchema).max(30).optional(),
  tags: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  needsProcurement: z.boolean().optional(),
  needsFinanceApproval: z.boolean().optional(),
  needsOperations: z.boolean().optional(),
  opportunityId: objectIdSchema.nullable().optional(),
});

/** One transition; the payload carries the stage's own fields (supplier, dates, weights, notes…). */
export const salesRequestTransitionSchema = z.object({
  transition: z.string().min(1),
  reason: text(1000).optional(),
  note: text(2000).optional(),
  attachmentIds: z.array(objectIdSchema).max(20).default([]),
  payload: z.record(z.string(), z.unknown()).default({}),
});
export type SalesRequestTransitionInput = z.infer<typeof salesRequestTransitionSchema>;

/** Stage-specific payloads validated by the service per transition. */
export const procurementPayloadSchema = z.object({
  supplierPartyId: objectIdSchema.optional(),
  supplierName: text(200).optional(),
  supplierQuoteAttachmentIds: z.array(objectIdSchema).optional(),
  receiptFormAttachmentId: objectIdSchema.optional(),
  deliveryDate: dateStr.optional(),
  notes: text().optional(),
});
export const financePayloadSchema = z.object({
  notes: text().optional(),
  purchaseDocumentAttachmentIds: z.array(objectIdSchema).optional(),
});
export const operationsPayloadSchema = z.object({
  scheduledVisitAt: dateStr.optional(),
  visitDurationMinutes: z
    .number()
    .int()
    .min(15)
    .max(24 * 60)
    .optional(),
  quantitiesKg: kg.optional(),
  weightsKg: kg.optional(),
  estimatedWeightKg: kg.optional(),
  estimatedQuantity: text(200).optional(),
  receiptReportAttachmentIds: z.array(objectIdSchema).optional(),
  deliveryReportAttachmentIds: z.array(objectIdSchema).optional(),
  notes: text().optional(),
  postponedTo: dateStr.optional(),
});
export const scrapPayloadSchema = z.object({
  proposedPriceHalalas: money.optional(),
  agreedPriceHalalas: money.optional(),
  actualWeightKg: kg.optional(),
  receiptReportAttachmentIds: z.array(objectIdSchema).optional(),
  transferProofAttachmentId: objectIdSchema.optional(),
  transferredHalalas: money.optional(),
  notes: text().optional(),
});
export const assetReturnPayloadSchema = z.object({
  nextConversationAt: dateStr.optional(),
  nonCooperationReason: text(500).optional(),
  notes: text().optional(),
});

/** Rental inspections [SAL §5.5]: one form per phase, photos, auto time, employee, signature / proof, notes, condition. */
export const rentalInspectionSchema = z.object({
  phase: z.enum(RENTAL_INSPECTION_PHASES),
  containerNumber: text(40).optional(),
  photoIds: z.array(objectIdSchema).min(1).max(30),
  signatureAttachmentId: objectIdSchema.optional(),
  receiptProofAttachmentId: objectIdSchema.optional(),
  containerCondition: text(500),
  notes: text().optional(),
});
export type RentalInspectionInput = z.infer<typeof rentalInspectionSchema>;

/** Scrap assessment visit result [SAL §5.6 ثالثاً, OPS §2.2]. */
export const scrapAssessmentSchema = z.object({
  visitAt: dateStr.optional(),
  result: text(2000),
  photoIds: z.array(objectIdSchema).max(30).default([]),
  inspectionReportAttachmentId: objectIdSchema.optional(),
  quantitiesKg: kg.optional(),
  estimatedWeightKg: kg.optional(),
  categories: z.array(text(80)).default([]),
  proposedPriceHalalas: money.optional(),
  agreedPriceHalalas: money.optional(),
  nextAction: text(500).optional(),
});
export type ScrapAssessmentInput = z.infer<typeof scrapAssessmentSchema>;

/** «رفع مهمة» on a scrap request [SAL §5.6 ثانياً]: a core task plus the scrap payload. */
export const scrapTaskSchema = z.object({
  assigneeUserId: objectIdSchema,
  customersToContact: z.number().int().min(0).optional(),
  taskType: text(80),
  assignedAt: dateStr.optional(),
  visitAt: dateStr.optional(),
  agreedPriceHalalas: money.optional(),
  notes: text().optional(),
  attachmentIds: z.array(objectIdSchema).max(20).default([]),
});
export type ScrapTaskInput = z.infer<typeof scrapTaskSchema>;
export const scrapTaskUpdateSchema = z.object({
  taskStatus: z.enum(['done', 'not_done']).optional(),
  transferStatus: z.enum(SCRAP_TRANSFER_STATUSES).optional(),
  transferProofAttachmentId: objectIdSchema.optional(),
  notes: text().optional(),
});

export const delayReasonSchema = z.object({
  delayReason: text(1000).min(2),
  responsibleDepartment: z.enum(REQUEST_HOLDERS),
});

export const listSalesRequestsQuerySchema = paginationSchema.extend({
  type: z.enum(SALES_SERVICE_TYPES).optional(),
  state: z.string().max(40).optional(),
  holder: z.enum(REQUEST_HOLDERS).optional(),
  open: z.coerce.boolean().optional(),
  overdue: z.coerce.boolean().optional(),
  customerId: objectIdSchema.optional(),
  ownerUserId: objectIdSchema.optional(),
  tag: z.string().trim().max(60).optional(),
  q: z.string().trim().max(120).optional(),
  /** Receiving department queue: requests the caller's department holds now (or held before). */
  view: z.enum(['mine', 'department', 'incoming']).optional(),
  includeHistory: z.coerce.boolean().optional(),
});

/** Q7 lists (DECISIONS §20): empty and editable until the owner sends them. */
export const SALES_LIST_KEYS = [
  'containerTypes',
  'containerSizes',
  'containerColors',
  'contractTypes',
  'wasteTypes',
  'cleaningServiceTypes',
  'destructionMaterials',
  'scrapCategories',
  'scrapTaskTypes',
  'tenderSources',
] as const;
export type SalesListKey = (typeof SALES_LIST_KEYS)[number];
