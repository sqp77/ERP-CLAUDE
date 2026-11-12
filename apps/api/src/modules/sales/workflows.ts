import type { StateDef, TransitionDef, WorkflowDefinitionInput } from '@eayni/shared';
import {
  SALES_REQUEST_STATE_AR,
  SALES_SERVICE_TYPES,
  STATE_HOLDER,
  type SalesServiceType,
} from '@eayni/shared';

/**
 * One workflow definition per Sales service [SAL §5 «آلية العمل», §6.1, §6.2; DECISIONS §20 changes 4–5]. They are
 * editable configuration (/admin/workflows) seeded by the baseline; the Sales module computes the actor relations:
 *   owner · sales_manager · executive · procurement_staff · procurement_manager · finance_staff · finance_manager ·
 *   ops_staff · ops_manager · scrap_transfer (roles from `sales.scrapTransferRoles`).
 * Operations states carry the OPS §2.1 labels verbatim so the Operations module can take the stage over later.
 */
export const workflowTypeFor = (type: SalesServiceType) => `sales_request_${type}`;

const S = (code: string, extra: Partial<StateDef> = {}): [string, StateDef] => [
  code,
  { labelAr: SALES_REQUEST_STATE_AR[code], category: 'open', owner: 'none', ...extra },
];
const states = (...defs: [string, StateDef][]) => Object.fromEntries(defs);
const T = (
  code: string,
  labelAr: string,
  from: string[],
  to: string,
  allow: string[],
  extra: Partial<TransitionDef> = {},
): TransitionDef => ({
  code,
  labelAr,
  from,
  to,
  allow,
  requiredFields: [],
  requireReason: false,
  notify: [],
  ...extra,
});

const SALES = ['owner', 'sales_manager'];
const PROC = ['procurement_staff', 'procurement_manager'];
const FIN_REVIEW = ['finance_staff', 'finance_manager'];
const FIN_DECIDE = ['finance_manager']; // DECISIONS §20 Q3
const OPS = ['ops_staff', 'ops_manager'];

// ---- shared state blocks ----------------------------------------------------------------------
const salesStates = () =>
  states(
    S('new', { owner: 'requester' }),
    S('quoting', { owner: 'requester' }),
    S('quote_sent', { category: 'waiting', owner: 'requester' }),
    S('negotiating', { owner: 'requester' }),
    S('customer_approved', { owner: 'requester' }),
  );
const procurementStates = () =>
  states(
    S('at_procurement', { slaBusinessDays: 3, owner: 'department' }),
    S('execution_started', { owner: 'department' }),
    S('execution_in_progress', { owner: 'department' }),
    S('execution_rejected', { owner: 'requester' }),
    S('execution_cancelled', { category: 'cancelled' }),
    S('execution_done', { owner: 'department' }),
  );
const financeStates = () =>
  states(
    S('at_finance', { category: 'waiting', slaBusinessDays: 3, owner: 'approver' }),
    S('finance_needs_info', { owner: 'requester' }),
    S('finance_rejected', { owner: 'requester' }),
  );
/** OPS §2.1 verbatim; «مجدول» must be reached within 3 business days [SAL §5.4, §6.1; DECISIONS §20 Q15]. */
const opsStates = () =>
  states(
    S('ops_new', { slaBusinessDays: 3, owner: 'department' }),
    S('ops_review', { slaBusinessDays: 3, owner: 'department' }),
    S('ops_scheduled', { owner: 'department' }),
    S('ops_in_progress', { owner: 'department' }),
    S('ops_completed', { owner: 'requester' }),
    S('ops_postponed', { category: 'waiting', owner: 'department' }),
    S('ops_cancelled', { owner: 'requester' }),
    S('ops_rejected', { owner: 'requester' }),
  );
const closingStates = () =>
  states(
    S('closed_success', { category: 'done' }),
    S('closed_incomplete', { category: 'done' }),
    S('suspended', { category: 'waiting', owner: 'department' }),
    S('cancelled', { category: 'cancelled' }),
  );

// ---- shared transition blocks -------------------------------------------------------------------
const quoteTransitions = (from = 'new') => [
  T('start_quote', 'إعداد عرض السعر', [from], 'quoting', SALES),
  T('send_quote', 'إرسال العرض للعميل', ['quoting', 'negotiating'], 'quote_sent', SALES),
  T('negotiate', 'قيد التفاوض', ['quote_sent'], 'negotiating', SALES),
  T('customer_approve', 'موافقة العميل', ['quote_sent', 'negotiating'], 'customer_approved', SALES),
  T('customer_reject', 'رفض العميل', ['quote_sent', 'negotiating'], 'closed_incomplete', SALES, {
    requireReason: true,
  }),
];
const procurementTransitions = (from: string[]) => [
  T('send_to_procurement', 'رفع طلب إلى المشتريات', from, 'at_procurement', SALES),
  T('procurement_to_finance', 'تحويل إلى المالية للاعتماد', ['at_procurement'], 'at_finance', PROC),
  T('execution_start', 'بدأ التنفيذ', ['execution_done', 'execution_in_progress'], 'execution_started', PROC),
  T('execution_progress', 'قيد المعالجة', ['execution_started'], 'execution_in_progress', PROC),
  T(
    'execution_reject',
    'تم الرفض',
    ['execution_started', 'execution_in_progress'],
    'execution_rejected',
    PROC,
    { requireReason: true },
  ),
  T(
    'execution_cancel',
    'تم الإلغاء',
    ['execution_started', 'execution_in_progress'],
    'execution_cancelled',
    [...PROC, ...SALES],
    { requireReason: true },
  ),
  T('execution_done', 'تم الإنجاز', ['execution_started', 'execution_in_progress'], 'execution_done', PROC),
  T(
    'resubmit_after_execution_reject',
    'إعادة الرفع إلى المشتريات',
    ['execution_rejected'],
    'at_procurement',
    SALES,
  ),
];
/** Finance stage: approve lands in `approvedTo`; staff may return for completion; the owner resubmits [PRC §4, DECISIONS §20 change 4]. */
const financeTransitions = (approvedTo: string, extraFrom: string[] = []) =>
  [
    T('send_to_finance', 'تحويل إلى المالية', extraFrom, 'at_finance', SALES),
    T('finance_approve', 'اعتماد', ['at_finance'], approvedTo, FIN_DECIDE),
    T('finance_reject', 'رفض', ['at_finance'], 'finance_rejected', FIN_DECIDE, { requireReason: true }),
    T('finance_request_info', 'يحتاج استكمال بيانات', ['at_finance'], 'finance_needs_info', FIN_REVIEW, {
      requireReason: true,
    }),
    T(
      'finance_resubmit',
      'إعادة الإرسال إلى المالية',
      ['finance_needs_info', 'finance_rejected'],
      'at_finance',
      SALES,
    ),
  ].filter((t) => t.from.length);
const opsTransitions = (from: string[], completedTo = 'ops_completed') => [
  T('send_to_operations', 'إحالة إلى التشغيل', from, 'ops_new', [...SALES, ...PROC]),
  T('ops_review', 'بدء المراجعة', ['ops_new'], 'ops_review', OPS),
  T('ops_schedule', 'جدولة الزيارة', ['ops_new', 'ops_review', 'ops_postponed'], 'ops_scheduled', OPS, {
    requiredFields: ['scheduledVisitAt'],
  }),
  T('ops_start', 'بدء التنفيذ', ['ops_scheduled'], 'ops_in_progress', OPS),
  T('ops_complete', 'مكتمل', ['ops_in_progress', 'ops_scheduled'], completedTo, OPS),
  T('ops_postpone', 'مؤجل', ['ops_scheduled', 'ops_in_progress', 'ops_review'], 'ops_postponed', OPS, {
    requireReason: true,
  }),
  T('ops_cancel', 'ملغي', ['ops_new', 'ops_review', 'ops_scheduled', 'ops_postponed'], 'ops_cancelled', OPS, {
    requireReason: true,
  }),
  T('ops_reject', 'مرفوض', ['ops_new', 'ops_review'], 'ops_rejected', OPS, { requireReason: true }),
  T('resend_to_operations', 'إعادة الإحالة إلى التشغيل', ['ops_cancelled', 'ops_rejected'], 'ops_new', SALES),
];
const closingTransitions = (from: string[]) => [
  T('close_success', 'تم الإغلاق بنجاح', from, 'closed_success', SALES),
  T('close_incomplete', 'تم الإغلاق دون استكمال', from, 'closed_incomplete', SALES, { requireReason: true }),
  T('suspend', 'تم إيقاف المشروع', from, 'suspended', ['sales_manager'], { requireReason: true }),
  T('resume', 'استئناف', ['suspended'], 'new', ['sales_manager']),
  T('cancel', 'تم إلغاء المشروع', [...from, 'suspended'], 'cancelled', ['sales_manager'], {
    requireReason: true,
  }),
];

const nonFinal = (st: Record<string, StateDef>) =>
  Object.entries(st)
    .filter(([, d]) => d.category !== 'done' && d.category !== 'cancelled')
    .map(([k]) => k);

function build(
  type: SalesServiceType,
  nameAr: string,
  st: Record<string, StateDef>,
  tr: TransitionDef[],
  initialState = 'new',
): WorkflowDefinitionInput {
  const all = { ...st, ...closingStates() };
  const open = nonFinal(all).filter((s) => s !== 'suspended');
  // S2 approval fix 1: once the record left Sales, a change goes back through this transition (reason required);
  // the service clears the Finance decision so the request must be approved again.
  const outsideSales = open.filter((s) => STATE_HOLDER[s] && STATE_HOLDER[s] !== 'sales');
  const backTo = all.customer_approved ? 'customer_approved' : 'new';
  if (outsideSales.length)
    tr = [
      ...tr,
      T('return_to_sales', 'إعادة إلى المبيعات للتعديل', outsideSales, backTo, SALES, {
        requireReason: true,
      }),
    ];
  return {
    type: workflowTypeFor(type),
    nameAr,
    version: 1,
    initialState,
    states: all,
    transitions: [...tr, ...closingTransitions(open)],
  };
}

/** §5.1 بيع الحاويات: quote → approval → Procurement (default) → Finance → execution → Operations when needed → close. */
const CONTAINER_SALE = build(
  'containerSale',
  'طلب بيع حاويات',
  { ...salesStates(), ...procurementStates(), ...financeStates(), ...opsStates() },
  [
    ...quoteTransitions(),
    ...procurementTransitions(['customer_approved', 'new']),
    ...financeTransitions('execution_started'),
    ...opsTransitions(['execution_done', 'customer_approved']),
  ],
);
/** §5.2 الفرز and §5.3 عقد النظافة: contracting → Finance / Procurement when needed → Operations → close. */
const contractRoute = (type: SalesServiceType, nameAr: string) =>
  build(
    type,
    nameAr,
    {
      ...salesStates(),
      ...states(S('contracting', { owner: 'requester' })),
      ...procurementStates(),
      ...financeStates(),
      ...opsStates(),
    },
    [
      ...quoteTransitions(),
      T('contract', 'رفع طلب التعاقد', ['customer_approved', 'new'], 'contracting', SALES),
      ...procurementTransitions(['contracting']),
      ...financeTransitions('contracting', ['contracting']),
      ...opsTransitions(['contracting', 'execution_done']),
    ],
  );
const SORTING = contractRoute('sortingContract', 'طلب عقد فرز');
const CLEANING = contractRoute('cleaningContract', 'طلب عقد نظافة');
/** §5.4 الإتلاف: photos → Operations estimate (optional visit) → pricing → approval → Finance → Operations (3 business days) → close. */
const DESTRUCTION = build(
  'destruction',
  'طلب إتلاف',
  { ...salesStates(), ...financeStates(), ...opsStates() },
  [
    T('send_for_estimate', 'رفع الصور إلى التشغيل لتقدير الوزن والكميات', ['new'], 'ops_new', SALES),
    T('ops_review', 'بدء المراجعة', ['ops_new'], 'ops_review', OPS),
    T('ops_schedule', 'جدولة زيارة تقييم', ['ops_new', 'ops_review', 'ops_postponed'], 'ops_scheduled', OPS, {
      requiredFields: ['scheduledVisitAt'],
    }),
    T('ops_start', 'بدء التنفيذ', ['ops_scheduled'], 'ops_in_progress', OPS),
    T(
      'estimate_done',
      'تسجيل التقدير وإعادة الطلب إلى المبيعات',
      ['ops_new', 'ops_review', 'ops_scheduled', 'ops_in_progress'],
      'quoting',
      OPS,
      { requiredFields: ['estimatedWeightKg'] },
    ),
    T('ops_complete', 'مكتمل', ['ops_in_progress'], 'ops_completed', OPS, {
      requiredFields: ['receiptReportAttachmentIds'],
    }),
    T('ops_postpone', 'مؤجل', ['ops_scheduled', 'ops_in_progress', 'ops_review'], 'ops_postponed', OPS, {
      requireReason: true,
    }),
    T(
      'ops_cancel',
      'ملغي',
      ['ops_new', 'ops_review', 'ops_scheduled', 'ops_postponed'],
      'ops_cancelled',
      OPS,
      { requireReason: true },
    ),
    T('ops_reject', 'مرفوض', ['ops_new', 'ops_review'], 'ops_rejected', OPS, { requireReason: true }),
    T(
      'resend_to_operations',
      'إعادة الإحالة إلى التشغيل',
      ['ops_cancelled', 'ops_rejected'],
      'ops_new',
      SALES,
    ),
    ...quoteTransitions('quoting').filter((t) => t.code !== 'start_quote'),
    ...financeTransitions('ops_new', ['customer_approved']),
  ],
);
/** §5.5 تأجير الحاويات: straight to Operations with the three inspection forms; a quote is optional. */
const RENTAL = build('containerRental', 'طلب تأجير حاويات', { ...salesStates(), ...opsStates() }, [
  ...quoteTransitions(),
  ...opsTransitions(['new', 'customer_approved']),
]);
/** §5.6 السكراب + OPS §2.2: visit → assessment → price agreed with Sales → pickup → actual weight & receipt → transfer → close. */
const SCRAP = build(
  'scrap',
  'طلب سكراب',
  {
    ...states(S('new', { owner: 'requester' })),
    ...opsStates(),
    ...states(
      S('assessed', { owner: 'requester' }),
      S('price_agreed', { owner: 'department' }),
      S('pickup_scheduled', { owner: 'department' }),
      S('collected', { owner: 'requester' }),
      S('transferred', { owner: 'requester' }),
    ),
  },
  [
    T('request_visit', 'طلب زيارة تقييم من التشغيل', ['new'], 'ops_new', SALES),
    T('ops_review', 'بدء المراجعة', ['ops_new'], 'ops_review', OPS),
    T(
      'ops_schedule',
      'جدولة زيارة التقييم',
      ['ops_new', 'ops_review', 'ops_postponed'],
      'ops_scheduled',
      OPS,
      { requiredFields: ['scheduledVisitAt'] },
    ),
    T('ops_start', 'بدء الزيارة', ['ops_scheduled'], 'ops_in_progress', OPS),
    T(
      'record_assessment',
      'تسجيل نتيجة التقييم',
      ['ops_scheduled', 'ops_in_progress', 'ops_review'],
      'assessed',
      [...OPS, ...SALES],
      { requiredFields: ['estimatedWeightKg'] },
    ),
    T('agree_price', 'الاتفاق على السعر', ['assessed', 'new'], 'price_agreed', SALES, {
      requiredFields: ['agreedPriceHalalas'],
    }),
    T('schedule_pickup', 'جدولة السحب', ['price_agreed'], 'pickup_scheduled', OPS, {
      requiredFields: ['scheduledVisitAt'],
    }),
    T(
      'record_collection',
      'تسجيل الوزن الفعلي ومحضر الاستلام',
      ['pickup_scheduled', 'price_agreed'],
      'collected',
      OPS,
      { requiredFields: ['actualWeightKg', 'receiptReportAttachmentIds'] },
    ),
    T('record_transfer', 'تسجيل تحويل المبلغ', ['collected'], 'transferred', ['scrap_transfer'], {
      requiredFields: ['transferProofAttachmentId'],
    }),
    T(
      'ops_postpone',
      'مؤجل',
      ['ops_scheduled', 'ops_in_progress', 'pickup_scheduled'],
      'ops_postponed',
      OPS,
      { requireReason: true },
    ),
    T(
      'ops_cancel',
      'ملغي',
      ['ops_new', 'ops_review', 'ops_scheduled', 'ops_postponed'],
      'ops_cancelled',
      OPS,
      { requireReason: true },
    ),
    T('ops_reject', 'مرفوض', ['ops_new', 'ops_review'], 'ops_rejected', OPS, { requireReason: true }),
    T('resend_to_operations', 'إعادة طلب الزيارة', ['ops_cancelled', 'ops_rejected'], 'ops_new', SALES),
  ],
);
/** §5.7 رجيع الأصول: the cooperation status is the state; a reason is required for «لم يتم التعاون». */
const ASSET_RETURN: WorkflowDefinitionInput = {
  type: workflowTypeFor('assetReturn'),
  nameAr: 'فرصة رجيع أصول (مناقصة)',
  version: 1,
  initialState: 'under_study',
  states: states(
    S('under_study', { owner: 'requester' }),
    S('negotiating', { owner: 'requester' }),
    S('cooperated', { category: 'done' }),
    S('not_cooperated', { category: 'done' }),
  ),
  transitions: [
    T('negotiate', 'قيد التفاوض', ['under_study'], 'negotiating', SALES),
    T('back_to_study', 'إعادة إلى الدراسة', ['negotiating'], 'under_study', SALES),
    T('cooperate', 'تم التعاون', ['under_study', 'negotiating'], 'cooperated', SALES),
    T('decline', 'لم يتم التعاون', ['under_study', 'negotiating'], 'not_cooperated', SALES, {
      requireReason: true,
    }),
  ],
};

export const SALES_WORKFLOWS: WorkflowDefinitionInput[] = [
  CONTAINER_SALE,
  SORTING,
  CLEANING,
  DESTRUCTION,
  RENTAL,
  SCRAP,
  ASSET_RETURN,
];
export const SALES_WORKFLOW_BY_TYPE: Record<SalesServiceType, WorkflowDefinitionInput> = Object.fromEntries(
  SALES_SERVICE_TYPES.map((t) => [t, SALES_WORKFLOWS.find((w) => w.type === workflowTypeFor(t))!]),
) as Record<SalesServiceType, WorkflowDefinitionInput>;
