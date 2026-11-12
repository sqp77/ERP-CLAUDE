import { z } from 'zod';
import { emailSchema, objectIdSchema, paginationSchema } from './common';

/**
 * Pricing, quotes, orders, contracts and the invoice register [SAL §3 م2–م6, §6.3, §7]. Money is integer halalas,
 * weights integer kilograms; a ton price is stored per ton and applied to kilograms with half-up rounding per line.
 */
export const PRICE_ITEM_KINDS = ['material', 'service'] as const;
export const PRICE_UNITS = ['ton', 'kg', 'piece', 'visit', 'month', 'contract', 'hour'] as const;
export type PriceUnit = (typeof PRICE_UNITS)[number];
export const PRICE_UNIT_AR: Record<PriceUnit, string> = {
  ton: 'طن',
  kg: 'كجم',
  piece: 'قطعة',
  visit: 'زيارة',
  month: 'شهر',
  contract: 'عقد',
  hour: 'ساعة',
};
export const createPriceItemSchema = z.object({
  kind: z.enum(PRICE_ITEM_KINDS),
  nameAr: z.string().trim().min(2).max(120),
  category: z.string().trim().max(80).optional(),
  unit: z.enum(PRICE_UNITS),
  /** First price, valid from today unless given. */
  priceHalalas: z.number().int().min(0).optional(),
  validFrom: z.string().datetime({ offset: true }).optional(),
  notes: z.string().trim().max(500).optional(),
});
export const updatePriceItemSchema = z.object({
  nameAr: z.string().trim().min(2).max(120).optional(),
  category: z.string().trim().max(80).nullable().optional(),
  active: z.boolean().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});
/** A new price is a new append-only entry with its own valid-from date [SAL §7.1, golden rule 3]. */
export const addPriceEntrySchema = z.object({
  priceHalalas: z.number().int().min(0),
  validFrom: z.string().datetime({ offset: true }).optional(),
  note: z.string().trim().max(500).optional(),
});
/** Weekly market price, entered by an authorized user (Q6 default: manual) [SAL §3 م2, §7.1]. */
export const addMarketPriceSchema = z.object({
  priceHalalas: z.number().int().min(0),
  weekOf: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  source: z.string().trim().max(200).optional(),
});

export const VAT_RATE_BP = 1500;

export const QUOTE_STATES = [
  'draft',
  'pending_approval',
  'approved',
  'sent',
  'accepted',
  'rejected',
  'negotiating',
  'cancelled',
] as const;
export type QuoteState = (typeof QUOTE_STATES)[number];
/** «مقبول، مرفوض، قيد التفاوض» are SAL §3; the internal states are the plan's (DECISIONS §20 S3). */
export const QUOTE_STATE_AR: Record<QuoteState, string> = {
  draft: 'مسودة',
  pending_approval: 'بانتظار الاعتماد',
  approved: 'معتمد',
  sent: 'مرسل',
  accepted: 'مقبول',
  rejected: 'مرفوض',
  negotiating: 'قيد التفاوض',
  cancelled: 'ملغي',
};
export const QUOTE_APPROVAL_LEVELS = ['none', 'manager', 'executive'] as const;
export type QuoteApprovalLevel = (typeof QUOTE_APPROVAL_LEVELS)[number];

export const quoteLineSchema = z.object({
  itemId: objectIdSchema,
  descriptionAr: z.string().trim().max(300).optional(),
  quantity: z.number().int().min(1),
  /** Basis points of the list price, or a fixed amount per unit (one of the two). */
  discountPercentBp: z.number().int().min(0).max(10_000).optional(),
  discountHalalas: z.number().int().min(0).optional(),
});
export const createQuoteSchema = z.object({
  customerId: objectIdSchema,
  opportunityId: objectIdSchema.optional(),
  requestId: objectIdSchema.optional(),
  lines: z.array(quoteLineSchema).min(1).max(100),
  validityDays: z.number().int().min(1).max(365).optional(),
  notesForCustomer: z.string().trim().max(2000).optional(),
  internalNotes: z.string().trim().max(2000).optional(),
  attachmentIds: z.array(objectIdSchema).max(20).default([]),
  contactId: objectIdSchema.optional(),
});
export type CreateQuoteInput = z.infer<typeof createQuoteSchema>;
export const updateQuoteSchema = createQuoteSchema.omit({ customerId: true }).partial();
export const quoteDecisionSchema = z.object({ note: z.string().trim().max(1000).optional() });
export const quoteSendSchema = z.object({
  to: z.array(emailSchema).min(1).max(10),
  cc: z.array(emailSchema).max(10).default([]),
  subject: z.string().trim().min(2).max(200).optional(),
  body: z.string().trim().max(5000).optional(),
  attachmentIds: z.array(objectIdSchema).max(20).default([]),
});
/** The customer's reply [SAL §3 م3]: accepted / rejected (reason required) / negotiating. */
export const quoteResponseSchema = z
  .object({
    response: z.enum(['accepted', 'rejected', 'negotiating']),
    reason: z.string().trim().max(120).optional(),
    note: z.string().trim().max(2000).optional(),
    signedFileAttachmentId: objectIdSchema.optional(),
    /** On acceptance: a sales order is always created; a contract draft too for contract services. */
    createContract: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.response === 'rejected' && !v.reason)
      ctx.addIssue({ code: 'custom', path: ['reason'], message: 'سبب الرفض مطلوب' });
  });
export const listQuotesQuerySchema = paginationSchema.extend({
  state: z.enum(QUOTE_STATES).optional(),
  customerId: objectIdSchema.optional(),
  opportunityId: objectIdSchema.optional(),
  requestId: objectIdSchema.optional(),
  ownerUserId: objectIdSchema.optional(),
  awaitingMyApproval: z.coerce.boolean().optional(),
  q: z.string().trim().max(120).optional(),
});
export const DEFAULT_QUOTE_REJECTION_REASONS = [
  'السعر',
  'المنافس',
  'التوقيت',
  'لا حاجة حالياً',
  'أخرى (مع توضيح)',
];

/** An order may carry several invoices (S3 fix 1); it is «مفوتر» once their sum reaches its total and «مغلق» once all of them are collected. */
export const SALES_ORDER_STATES = ['open', 'partially_invoiced', 'invoiced', 'closed', 'cancelled'] as const;
export const SALES_ORDER_STATE_AR: Record<(typeof SALES_ORDER_STATES)[number], string> = {
  open: 'مفتوح',
  partially_invoiced: 'مفوتر جزئياً',
  invoiced: 'مفوتر',
  closed: 'مغلق',
  cancelled: 'ملغي',
};

/** Periodic contracts [SAL §7.4, §6.3]. */
export const CONTRACT_STATES = ['draft', 'active', 'expiring', 'expired', 'renewed', 'terminated'] as const;
export const SALES_CONTRACT_STATE_AR: Record<(typeof CONTRACT_STATES)[number], string> = {
  draft: 'مسودة',
  active: 'ساري',
  expiring: 'قرب الانتهاء',
  expired: 'منتهي',
  renewed: 'مجدَّد',
  terminated: 'منتهٍ مبكرًا',
};
export const SCHEDULE_KINDS = ['delivery', 'pickup', 'visit'] as const;
export const SCHEDULE_KIND_AR: Record<(typeof SCHEDULE_KINDS)[number], string> = {
  delivery: 'تسليم',
  pickup: 'استلام',
  visit: 'زيارة',
};
export const SCHEDULE_STATUSES = ['planned', 'done', 'missed'] as const;
export const SCHEDULE_STATUS_AR: Record<(typeof SCHEDULE_STATUSES)[number], string> = {
  planned: 'مخطط',
  done: 'تم',
  missed: 'لم يتم',
};
export const contractItemSchema = z.object({
  itemId: objectIdSchema.optional(),
  descriptionAr: z.string().trim().min(1).max(300),
  quantity: z.number().int().min(0).optional(),
  unit: z.enum(PRICE_UNITS).optional(),
  agreedPriceHalalas: z.number().int().min(0).optional(),
});
export const scheduleEntrySchema = z.object({
  plannedAt: z.string().datetime({ offset: true }),
  kind: z.enum(SCHEDULE_KINDS),
  note: z.string().trim().max(300).optional(),
});
export const createContractSchema = z.object({
  customerId: objectIdSchema,
  contractType: z.string().trim().max(80).optional(),
  requestId: objectIdSchema.optional(),
  salesOrderId: objectIdSchema.optional(),
  quoteId: objectIdSchema.optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  items: z.array(contractItemSchema).max(100).default([]),
  schedule: z.array(scheduleEntrySchema).max(500).default([]),
  signedFileAttachmentId: objectIdSchema.optional(),
  notes: z.string().trim().max(2000).optional(),
  renewalOf: objectIdSchema.optional(),
});
export const updateContractSchema = createContractSchema
  .omit({ customerId: true, renewalOf: true })
  .partial();
/** Quantities delivered / collected on a done schedule entry, per contract item (matched by itemId, else by description); they feed the period invoice [SAL §7.3, §7.4]. */
export const scheduleQuantitySchema = z.object({
  itemId: objectIdSchema.optional(),
  descriptionAr: z.string().trim().max(300).optional(),
  quantity: z.number().int().min(0),
});
export const scheduleStatusSchema = z.object({
  status: z.enum(SCHEDULE_STATUSES),
  note: z.string().trim().max(300).optional(),
  doneAt: z.string().datetime({ offset: true }).optional(),
  quantities: z.array(scheduleQuantitySchema).max(100).optional(),
});
export const certificateSendSchema = z.object({
  to: z.array(emailSchema).min(1).max(10),
  note: z.string().trim().max(500).optional(),
});
export const listContractsQuerySchema = paginationSchema.extend({
  state: z.enum(CONTRACT_STATES).optional(),
  customerId: objectIdSchema.optional(),
  expiringWithinDays: z.coerce.number().int().min(1).max(400).optional(),
  q: z.string().trim().max(120).optional(),
});

/** Invoice register — Finance owns it [SAL §7.3, FIN §7, §10]. Q4 option A: Finance records the invoice issued in the current system. */
export const INVOICE_KINDS = ['tax', 'simplified'] as const;
export const COLLECTION_STATES = ['due', 'partially_collected', 'collected', 'overdue'] as const;
export const COLLECTION_STATE_AR: Record<(typeof COLLECTION_STATES)[number], string> = {
  due: 'مستحق',
  partially_collected: 'محصل جزئياً',
  collected: 'محصل بالكامل',
  overdue: 'متأخر',
};
export const ZATCA_STATES = ['pending', 'sent', 'accepted', 'rejected'] as const;
export const ZATCA_STATE_AR: Record<(typeof ZATCA_STATES)[number], string> = {
  pending: 'بانتظار الإرسال',
  sent: 'تم الإرسال',
  accepted: 'مقبول',
  rejected: 'مرفوض',
};
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** The invoice's source: an approved sales order (several invoices allowed, sum ≤ order total) or a periodic contract (per period or per completed schedule entries) [SAL §7.3 «بناءً على أمر البيع أو العقد المعتمد»]. */
export const invoiceSourceSchema = z
  .object({
    salesOrderId: objectIdSchema.optional(),
    contractId: objectIdSchema.optional(),
    /** Contract only: the invoiced period (schedule entries done in it) … */
    periodFrom: dateOnly.optional(),
    periodTo: dateOnly.optional(),
    /** … or an explicit list of completed schedule entries. */
    scheduleEntryIds: z.array(objectIdSchema).max(500).optional(),
  })
  .superRefine((v, ctx) => {
    if (!v.salesOrderId === !v.contractId)
      ctx.addIssue({ code: 'custom', path: ['salesOrderId'], message: 'حدّد أمر البيع أو العقد (أحدهما)' });
    if (v.contractId && !v.scheduleEntryIds?.length && !(v.periodFrom && v.periodTo))
      ctx.addIssue({
        code: 'custom',
        path: ['periodFrom'],
        message: 'حدّد الفترة أو المواعيد المنفَّذة المراد فوترتها',
      });
    if (v.periodFrom && v.periodTo && v.periodFrom > v.periodTo)
      ctx.addIssue({ code: 'custom', path: ['periodTo'], message: 'نهاية الفترة قبل بدايتها' });
  });
export const invoicePrefillSchema = invoiceSourceSchema;
/** Finance may correct the prefilled lines to what the issued invoice actually carries (option A). */
export const invoiceLineInputSchema = z.object({
  itemId: objectIdSchema.optional(),
  descriptionAr: z.string().trim().min(1).max(300),
  unit: z.string().trim().max(20).optional(),
  quantity: z.number().int().min(0),
  unitPriceHalalas: z.number().int().min(0),
  vatRateBp: z.number().int().min(0).max(10_000).optional(),
});
export const invoiceTotalsSchema = z.object({
  subtotalHalalas: z.number().int().min(0),
  vatTotalHalalas: z.number().int().min(0),
  totalHalalas: z.number().int().min(0),
});
export const registerInvoiceSchema = invoiceSourceSchema.and(
  z.object({
    kind: z.enum(INVOICE_KINDS).default('tax'),
    /** Number of the invoice issued in the current accounting system (option A). */
    externalNumber: z.string().trim().min(1).max(60),
    issueDateTime: z.string().datetime({ offset: true }),
    dueDate: dateOnly,
    /** Actual lines / totals of the issued invoice; omitted → the prefilled ones. A difference needs a reason. */
    lines: z.array(invoiceLineInputSchema).min(1).max(200).optional(),
    totals: invoiceTotalsSchema.optional(),
    differenceReason: z.string().trim().max(500).optional(),
    pdfAttachmentId: objectIdSchema.optional(),
    notes: z.string().trim().max(1000).optional(),
  }),
);
export type RegisterInvoiceInput = z.infer<typeof registerInvoiceSchema>;
export const PAYMENT_METHODS = ['bank_transfer', 'card', 'cash', 'other'] as const;
export const PAYMENT_METHOD_AR: Record<(typeof PAYMENT_METHODS)[number], string> = {
  bank_transfer: 'تحويل بنكي',
  card: 'بطاقة',
  cash: 'نقدي',
  other: 'أخرى',
};
export const recordPaymentSchema = z.object({
  amountHalalas: z.number().int().min(1),
  paidAt: z.string().datetime({ offset: true }).optional(),
  method: z.enum(PAYMENT_METHODS).default('bank_transfer'),
  reference: z.string().trim().max(120).optional(),
  proofAttachmentId: objectIdSchema.optional(),
});
export const listInvoicesQuerySchema = paginationSchema.extend({
  customerId: objectIdSchema.optional(),
  salesOrderId: objectIdSchema.optional(),
  contractId: objectIdSchema.optional(),
  collectionState: z.enum(COLLECTION_STATES).optional(),
  overdue: z.coerce.boolean().optional(),
  q: z.string().trim().max(120).optional(),
});
