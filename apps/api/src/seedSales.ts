import type { RoleAssignment } from '@eayni/shared';
import { User } from './core/auth/model';
import { Department } from './core/org/model';
import { effectivePermission, roleCodesOf } from './core/rbac/service';
import type { AuthedRequest } from './core/http/context';
import { Customer, Lead } from './modules/crm/model';
import {
  addLog,
  assignLead,
  createCustomer,
  createLead,
  transferCustomers,
  updateCustomer,
} from './modules/crm/service';
import { changeStage, createOpportunity } from './modules/sales/service';
import { createRequest, transitionRequest } from './modules/sales/requests.service';
import { addMarketPrice, createPriceItem } from './modules/sales/pricing.service';
import { setTarget, withdrawTarget } from './modules/sales/management.service';
import { addMessage, openDiscussion, setState as setDiscussionState } from './core/discussions/service';
import { CalendarEvent } from './core/calendar/model';
import { nextNumber } from './core/numbering/service';
import { riyadhPeriod } from './core/kpi/service';
import { registerModules } from './bootstrap';
import { logger } from './logger';
import {
  createQuote,
  respondQuote,
  sendQuote,
  submitQuote,
  decideQuote,
} from './modules/sales/quotes.service';
import { createContract } from './modules/sales/contracts.service';
import { registerInvoice, recordPayment } from './modules/finance/invoices.service';

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

/**
 * Sample Sales data for local testing [SAL §4]: customers for the two reps, contacts, a communication log with
 * follow-ups, opportunities across the stages, two leads from Customer Service (one overdue), a transfer with
 * history, and a manager classification. Idempotent. Sample people come from seedHr.
 */
export async function seedSales(): Promise<{ customers: number; leads: number }> {
  if (await Customer.countDocuments()) return { customers: 0, leads: 0 };
  const sales = await Department.findOne({ code: 'sales' });
  if (!sales) return { customers: 0, leads: 0 };
  const byEmail = async (email: string) => {
    const u = await User.findOne({ email });
    if (!u) throw new Error(`seed: user ${email} missing`);
    return u;
  };
  const reqOf = async (
    u: InstanceType<typeof User>,
    resource: string,
    action: 'create' | 'edit' | 'approve' | 'view',
  ): Promise<AuthedRequest> => {
    const deptId = u.departmentId ? String(u.departmentId) : undefined;
    const eff = await effectivePermission(
      u.roles as RoleAssignment[],
      deptId,
      resource,
      action,
      String(u._id),
    );
    // Role codes include the implied ones (the Sales department manager is a sales_manager; Sales members are reps).
    const roleCodes = await roleCodesOf(u.roles as RoleAssignment[], deptId);
    return {
      auth: { user: u, roleCodes, ip: '', userAgent: 'seed', requestId: 'seed', session: {} as never },
      authz: { resource, action, scope: eff?.scope ?? 'own', departmentIds: eff?.departmentIds ?? [] },
      ip: '127.0.0.1',
      headers: {},
    } as unknown as AuthedRequest;
  };

  const [sultan, reem, majed, arwa] = await Promise.all(
    ['sultan', 'reem', 'majed', 'arwa'].map((n) => byEmail(`${n}@eayni.local`)),
  );

  const c = async (u: InstanceType<typeof User>, body: Record<string, unknown>) =>
    createCustomer(await reqOf(u, 'crm.customers', 'create'), {
      kind: 'organization',
      status: 'potential',
      tags: [],
      contacts: [],
      ...body,
    } as never);

  const gulf = await c(reem, {
    nameAr: 'شركة الخليج للتغليف',
    country: 'السعودية',
    region: 'المنطقة الشرقية',
    city: 'الدمام',
    activity: 'تغليف وتعبئة',
    organizationType: 'خاص',
    facilitySize: 'متوسطة',
    source: 'field_visits',
    phone: '0501234567',
    email: 'info@gulfpack.example',
    crNumber: '2050012345',
    nationalAddress: 'الدمام، حي الفيصلية، 32241',
    status: 'active',
    tags: ['#عميل_استراتيجي', '#عقد_سنوي'],
    contacts: [
      {
        nameAr: 'أحمد العلي',
        jobTitle: 'مدير المشتريات',
        phone: '0551112222',
        email: 'ahmed@gulfpack.example',
      },
      { nameAr: 'سعد الحربي', jobTitle: 'المدير المالي', phone: '0553334444' },
    ],
    opportunity: {
      title: 'توريد 50 حاوية 1100 لتر',
      serviceType: 'containerSale',
      expectedValueHalalas: 12_500_000,
      nextFollowUpAt: inDays(2),
    },
  });
  const school = await c(reem, {
    nameAr: 'مدارس الرواد الأهلية',
    country: 'السعودية',
    region: 'المنطقة الشرقية',
    city: 'الخبر',
    activity: 'تعليم',
    organizationType: 'خاص',
    facilitySize: 'كبيرة',
    source: 'exhibitions',
    phone: '0138765432',
    status: 'potential',
    tags: ['#عميل_جديد', '#يحتاج_زيارة'],
    contacts: [{ nameAr: 'منى القحطاني', jobTitle: 'مديرة الشؤون الإدارية', phone: '0566778899' }],
    opportunity: {
      title: 'عقد نظافة وجمع نفايات عامة',
      serviceType: 'cleaningContract',
      expectedValueHalalas: 4_800_000,
      nextFollowUpAt: inDays(-1),
    },
  });
  const steel = await c(majed, {
    nameAr: 'مصنع الشرق للحديد',
    country: 'السعودية',
    region: 'المنطقة الشرقية',
    city: 'الجبيل',
    activity: 'صناعة',
    organizationType: 'خاص',
    facilitySize: 'كبيرة',
    source: 'direct_contact',
    phone: '0135551234',
    status: 'cooperating',
    unifiedNumber: '7001234567',
    vatNumber: '300123456700003',
    tags: ['#سكراب'],
    contacts: [{ nameAr: 'خالد المطيري', jobTitle: 'مدير المصنع', phone: '0544445555' }],
    opportunity: {
      title: 'شراء سكراب حديد شهري',
      serviceType: 'scrap',
      expectedValueHalalas: 30_000_000,
      nextFollowUpAt: inDays(5),
    },
  });
  const municipality = await c(majed, {
    nameAr: 'أمانة المنطقة الشرقية — بلدية الظهران',
    country: 'السعودية',
    region: 'المنطقة الشرقية',
    city: 'الظهران',
    activity: 'جهة حكومية',
    organizationType: 'حكومي',
    facilitySize: 'كبيرة',
    source: 'referrals',
    phone: '0138001234',
    status: 'potential',
    tags: ['#مناقصة'],
    opportunity: {
      title: 'مناقصة رجيع أصول — أثاث مكتبي',
      serviceType: 'assetReturn',
      expectedValueHalalas: 8_000_000,
    },
  });
  const stopped = await c(majed, {
    nameAr: 'مطابع النور',
    country: 'السعودية',
    region: 'المنطقة الشرقية',
    city: 'الدمام',
    activity: 'طباعة',
    organizationType: 'خاص',
    facilitySize: 'صغيرة',
    source: 'social_media',
    phone: '0509876543',
    status: 'stopped',
  });

  // Communication log with follow-ups (reem on the Gulf file; majed on the steel plant).
  const logReem = await reqOf(reem, 'crm.customers', 'view');
  await addLog(logReem, String(gulf._id), {
    method: 'call',
    details: 'اتصال تعريفي؛ العميل يطلب عرض سعر لـ 50 حاوية',
    customerNeed: '50 حاوية 1100 لتر',
    nextStep: 'زيارة ميدانية لمعاينة الموقع',
    nextFollowUpAt: inDays(-3),
    attachmentIds: [],
  });
  await addLog(logReem, String(gulf._id), {
    method: 'visit',
    details: 'زيارة الموقع؛ تم الاتفاق على المواصفات',
    outcome: 'إرسال عرض سعر خلال يومين',
    nextStep: 'إعداد عرض السعر',
    nextFollowUpAt: inDays(2),
    attachmentIds: [],
  });
  await addLog(logReem, String(school._id), {
    method: 'meeting',
    details: 'اجتماع مع إدارة المدارس في المعرض',
    customerNeed: 'عقد نظافة سنوي',
    nextStep: 'جدولة زيارة',
    nextFollowUpAt: inDays(-1),
    attachmentIds: [],
  });
  const logMajed = await reqOf(majed, 'crm.customers', 'view');
  await addLog(logMajed, String(steel._id), {
    method: 'email',
    details: 'إرسال نبذة عن خدمة السكراب',
    outcome: 'العميل مهتم بشراء شهري',
    nextFollowUpAt: inDays(5),
    attachmentIds: [],
  });

  // Opportunities across the stages.
  const { Opportunity } = await import('./modules/sales/model');
  const stageOf = async (
    u: InstanceType<typeof User>,
    customerId: unknown,
    stage: string,
    extra: Record<string, unknown> = {},
  ) => {
    const o = await Opportunity.findOne({ customerId }).lean();
    if (o)
      await changeStage(await reqOf(u, 'sales.opportunities', 'edit'), String(o._id), {
        stage,
        ...extra,
      } as never);
  };
  await stageOf(reem, gulf._id, 'quote_sent');
  await stageOf(reem, school._id, 'meeting_scheduled');
  await stageOf(majed, steel._id, 'negotiating');
  await createOpportunity(await reqOf(majed, 'sales.opportunities', 'create'), {
    customerId: String(stopped._id),
    title: 'تأجير حاويات لمعرض',
    serviceType: 'containerRental',
    expectedValueHalalas: 600_000,
    attachmentIds: [],
    tags: ['#تأجير_حاويات'],
  });
  await stageOf(majed, stopped._id, 'lost', {
    lostReason: 'السعر',
    lostNote: 'اختار العميل عرضًا أقل من منافس',
  });
  const won = await createOpportunity(await reqOf(reem, 'sales.opportunities', 'create'), {
    customerId: String(gulf._id),
    title: 'إتلاف أرشيف قديم',
    serviceType: 'destruction',
    expectedValueHalalas: 350_000,
    attachmentIds: [],
    tags: [],
  });
  await changeStage(await reqOf(reem, 'sales.opportunities', 'edit'), String(won._id), { stage: 'won' });

  // Manager actions: classification and a transfer with history [SAL §8.1, §12].
  const mgrEdit = await reqOf(sultan, 'crm.customers', 'edit');
  await updateCustomer(mgrEdit, String(gulf._id), { classification: 'strategic' } as never);
  await updateCustomer(mgrEdit, String(steel._id), { classification: 'regular' } as never);
  await transferCustomers(await reqOf(sultan, 'crm.customers', 'approve'), {
    customerIds: [String(municipality._id)],
    toUserId: String(reem._id),
    reason: 'إعادة توزيع الجهات الحكومية',
    includeOpportunities: true,
  });

  // Leads from Customer Service: one assigned to reem, one unassigned and already past the 24-hour window.
  const csReq = await reqOf(arwa, 'crm.leads', 'create');
  const lead1 = await createLead(csReq, {
    customerName: 'مطعم النخيل',
    contactName: 'فهد السبيعي',
    phone: '0561234567',
    interest: 'عقد نظافة أسبوعي لثلاثة فروع',
    channel: 'واتساب',
    targetDepartment: 'sales',
    attachmentIds: [],
  });
  await assignLead(await reqOf(sultan, 'crm.leads', 'approve'), String(lead1._id), String(reem._id));
  const lead2 = await createLead(csReq, {
    customerName: 'مجمع الواحة السكني',
    contactName: 'إدارة المجمع',
    phone: '0138123456',
    interest: 'حاويات ملابس عيني',
    channel: 'الهاتف الموحد',
    targetDepartment: 'sales',
    attachmentIds: [],
  });
  await Lead.updateOne({ _id: lead2._id }, { $set: { referredAt: hoursAgo(30) } });

  // Service requests across the route [SAL §5, §6]: a container sale at Finance, a rental at Operations, a scrap
  // request assessed, a destruction awaiting the Operations estimate, and an asset-return opportunity.
  const [nasser, abdulaziz, khalid] = await Promise.all(
    ['nasser', 'abdulaziz', 'khalid'].map((n) => byEmail(`${n}@eayni.local`)),
  );
  const salesReq = await reqOf(reem, 'sales.requests', 'create');
  const mv = async (
    u: InstanceType<typeof User>,
    id: unknown,
    transition: string,
    extra: Record<string, unknown> = {},
  ) =>
    transitionRequest(await reqOf(u, 'sales.requests', 'edit'), String(id), {
      transition,
      attachmentIds: [],
      payload: {},
      ...extra,
    } as never);
  const csr = await createRequest(salesReq, {
    type: 'containerSale',
    customerId: String(gulf._id),
    details: { count: 50, containerType: 'حاوية 1100 لتر', color: 'أخضر', agreedPriceHalalas: 12_500_000 },
    attachmentIds: [],
    photoIds: [],
    tags: ['#عقد_سنوي'],
  } as never);
  for (const step of ['start_quote', 'send_quote', 'customer_approve', 'send_to_procurement'])
    await mv(reem, csr._id, step);
  await mv(nasser, csr._id, 'procurement_to_finance', { payload: { supplierName: 'مصنع الحاويات الوطني' } });
  const rnt = await createRequest(salesReq, {
    type: 'containerRental',
    customerId: String(school._id),
    details: {
      containerCount: 3,
      deliveryZone: 'inside_eastern',
      rentalDurationDays: 30,
      requestedDeliveryDate: inDays(7),
    },
    attachmentIds: [],
    photoIds: [],
    tags: ['#تأجير_حاويات'],
  } as never);
  await mv(reem, rnt._id, 'send_to_operations');
  await mv(khalid, rnt._id, 'ops_schedule', { payload: { scheduledVisitAt: inDays(5) } });
  const majedReq = await reqOf(majed, 'sales.requests', 'create');
  const scr = await createRequest(majedReq, {
    type: 'scrap',
    customerId: String(steel._id),
    details: {
      materialType: 'حديد',
      estimatedQuantityKg: 3000,
      mobile: '0544445555',
      materialDescription: 'خردة حديد من خط إنتاج قديم',
    },
    attachmentIds: [],
    photoIds: [],
    tags: ['#سكراب'],
  } as never);
  await mv(majed, scr._id, 'request_visit');
  await mv(khalid, scr._id, 'ops_schedule', { payload: { scheduledVisitAt: inDays(2) } });
  await createRequest(salesReq, {
    type: 'destruction',
    customerId: String(gulf._id),
    details: {
      materialType: 'أرشيف ورقي',
      estimatedQuantityKg: 600,
      contactPersonName: 'أحمد العلي',
      contactPhone: '0551112222',
    },
    attachmentIds: [],
    photoIds: [],
    tags: [],
  } as never).then((r) => mv(reem, r._id, 'send_for_estimate'));
  await createRequest(salesReq, {
    type: 'assetReturn',
    customerId: String(municipality._id),
    details: {
      tenderSource: 'منصة اعتماد',
      assetType: 'أثاث مكتبي',
      facilitySize: 'كبيرة',
      nextConversationAt: inDays(3),
    },
    attachmentIds: [],
    photoIds: [],
    tags: ['#مناقصة'],
  } as never);
  // Price list (Q6: filled from the screen by the Sales manager), quotes across the approval path, an order, a
  // registered invoice with a partial payment, and a one-year contract [SAL §7].
  const mgrPrice = await reqOf(sultan, 'sales.pricelist', 'view');
  const cardboard = await createPriceItem(mgrPrice, {
    kind: 'material',
    nameAr: 'كرتون',
    category: 'ورق',
    unit: 'ton',
    priceHalalas: 60_000_00,
  });
  const plastic = await createPriceItem(mgrPrice, {
    kind: 'material',
    nameAr: 'بلاستيك PET',
    category: 'بلاستيك',
    unit: 'ton',
    priceHalalas: 2_200_00 * 50,
  });
  const visitSvc = await createPriceItem(mgrPrice, {
    kind: 'service',
    nameAr: 'زيارة جمع نفايات عامة',
    unit: 'visit',
    priceHalalas: 350_00,
  });
  const containerSale = await createPriceItem(mgrPrice, {
    kind: 'material',
    nameAr: 'حاوية 1100 لتر',
    category: 'حاويات',
    unit: 'piece',
    priceHalalas: 2_500_00,
  });
  const reemQuotes = await reqOf(reem, 'sales.quotes', 'create');
  const quoteA = await createQuote(reemQuotes, {
    customerId: String(gulf._id),
    opportunityId: String(
      (await Opportunity.findOne({ customerId: gulf._id, serviceType: 'containerSale' }).lean())?._id ?? '',
    ),
    requestId: String(csr._id),
    lines: [{ itemId: String(containerSale!._id), quantity: 50, discountPercentBp: 400 }],
    attachmentIds: [],
  } as never);
  await submitQuote(reemQuotes, String(quoteA._id)); // limits unset → pending the executive
  const quoteB = await createQuote(reemQuotes, {
    customerId: String(school._id),
    lines: [{ itemId: String(visitSvc!._id), quantity: 48 }],
    attachmentIds: [],
    notesForCustomer: 'زيارة أسبوعية لمدة سنة',
  } as never);
  await submitQuote(reemQuotes, String(quoteB._id)); // no discount → approved
  await sendQuote(reemQuotes, String(quoteB._id), {
    to: ['admin@alrowad.example'],
    cc: [],
    attachmentIds: [],
  });
  const accepted = await respondQuote(reemQuotes, String(quoteB._id), { response: 'accepted' });
  const abdullah = await byEmail('abdullah@eayni.local');
  await decideQuote(
    await reqOf(abdullah, 'sales.quotes', 'approve'),
    String(quoteA._id),
    'approve',
    'ضمن السياسة',
  );
  const financeReq = await reqOf(abdulaziz, 'finance.invoices', 'create');
  const inv = await registerInvoice(financeReq, {
    salesOrderId: String((accepted as { salesOrder?: { _id: unknown } }).salesOrder?._id),
    kind: 'tax',
    externalNumber: 'ERP-INV-2026-0117',
    issueDateTime: new Date(Date.now() - 20 * 86_400_000).toISOString(),
    dueDate: inDays(10).slice(0, 10),
  });
  await recordPayment(financeReq, String(inv._id), {
    amountHalalas: Math.round(inv.totalHalalas / 2),
    method: 'bank_transfer',
    reference: 'TRX-20451',
  });
  await createContract(await reqOf(reem, 'sales.contracts', 'create'), {
    customerId: String(school._id),
    contractType: 'عقد نظافة سنوي',
    quoteId: String(quoteB._id),
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    items: [
      {
        itemId: String(visitSvc!._id),
        descriptionAr: 'زيارة جمع نفايات عامة',
        quantity: 48,
        unit: 'visit',
        agreedPriceHalalas: 350_00,
      },
    ],
    schedule: [
      { plannedAt: inDays(3), kind: 'pickup' },
      { plannedAt: inDays(10), kind: 'pickup' },
    ],
  } as never);
  void plastic;

  // S4 [SAL §11, §11.1, §10.3]: a cardboard sale invoiced and fully collected this month (tons and collection days
  // for the KPI board), a weekly market price, monthly targets (one changed with a reason → two versions), and a
  // discussion with Finance on a customer. Record resolvers come from the module registry.
  registerModules();
  await addMarketPrice(mgrPrice, String(cardboard!._id), { priceHalalas: 57_500_00, source: 'سوق الدمام' });
  const quoteC = await createQuote(reemQuotes, {
    customerId: String(gulf._id),
    lines: [{ itemId: String(cardboard!._id), quantity: 3 }],
    attachmentIds: [],
  } as never);
  await submitQuote(reemQuotes, String(quoteC._id));
  await sendQuote(reemQuotes, String(quoteC._id), {
    to: ['procurement@gulfpack.example'],
    cc: [],
    attachmentIds: [],
  });
  const acceptedC = await respondQuote(reemQuotes, String(quoteC._id), { response: 'accepted' });
  const issuedAt = new Date(Date.now() - 2 * 86_400_000);
  const invC = await registerInvoice(financeReq, {
    salesOrderId: String((acceptedC as { salesOrder?: { _id: unknown } }).salesOrder?._id),
    kind: 'tax',
    externalNumber: 'ERP-INV-2026-0123',
    issueDateTime: issuedAt.toISOString(),
    dueDate: inDays(28).slice(0, 10),
  });
  await recordPayment(financeReq, String(invC._id), {
    amountHalalas: invC.totalHalalas,
    method: 'bank_transfer',
    reference: 'TRX-20488',
  });
  const period = riyadhPeriod();
  const targetsReq = await reqOf(sultan, 'sales.targets', 'edit');
  await setTarget(targetsReq, {
    period,
    scope: 'department',
    dimension: 'none',
    metric: 'revenue',
    value: 400_000_00,
  });
  await setTarget(targetsReq, {
    period,
    scope: 'user',
    userId: String(reem._id),
    dimension: 'none',
    metric: 'revenue',
    value: 200_000_00,
  });
  await setTarget(targetsReq, {
    period,
    scope: 'user',
    userId: String(reem._id),
    dimension: 'none',
    metric: 'revenue',
    value: 250_000_00,
    reason: 'إضافة عقد شركة الخليج للتغليف',
  });
  await setTarget(targetsReq, {
    period,
    scope: 'user',
    userId: String(majed._id),
    dimension: 'material',
    dimensionKey: String(cardboard!._id),
    metric: 'quantity',
    value: 10_000,
  });
  const finance = await Department.findOne({ code: 'finance' }).lean();
  if (finance) {
    const disc = await openDiscussion(await reqOf(reem, 'discussions', 'create'), {
      recordType: 'customer',
      recordId: String(gulf._id),
      title: 'نسخة من فاتورة الشهر الماضي للعميل',
      details: 'العميل يطلب نسخة من الفاتورة ERP-INV-2026-0117 لاعتمادها لديه.',
      targetDepartmentId: String(finance._id),
      participantUserIds: [],
      attachmentIds: [],
    });
    await addMessage(
      await reqOf(abdulaziz, 'discussions', 'view'),
      String(disc._id),
      'تم، سنرسلها اليوم على البريد الرسمي للعميل.',
      [],
    );
  }
  // The every-state sample runs last and never blocks the rest of the seed: a failure is logged, not thrown.
  try {
    // S5 [SAL §17 المرحلة الخامسة «بيانات لكل حالة»]: the states the earlier sample does not reach — a customer «غير مهتم»,
    // opportunities «قيد المعالجة» and «تم التواصل», quotes draft / sent / rejected / negotiating, an overdue invoice,
    // sorting and cleaning requests, discussions «بانتظار الرد» and «مغلقة», meetings in every calendar status (one that
    // told Marketing), a withdrawn target and last month's department target for the month comparison.
    await c(majed, {
      nameAr: 'مؤسسة الريان التجارية',
      country: 'السعودية',
      region: 'المنطقة الشرقية',
      city: 'الخبر',
      activity: 'تجارة جملة',
      organizationType: 'خاص',
      facilitySize: 'صغيرة',
      source: 'field_visits',
      phone: '0533334444',
      status: 'not_interested',
    });
    const oppIn = await createOpportunity(await reqOf(majed, 'sales.opportunities', 'create'), {
      customerId: String(steel._id),
      title: 'توريد بلاستيك PET شهري',
      serviceType: 'scrap',
      expectedValueHalalas: 5_500_000,
      attachmentIds: [],
      tags: [],
    });
    await changeStage(await reqOf(majed, 'sales.opportunities', 'edit'), String(oppIn._id), {
      stage: 'in_progress',
    });
    const oppContacted = await createOpportunity(await reqOf(reem, 'sales.opportunities', 'create'), {
      customerId: String(school._id),
      title: 'فرز نفايات المدارس',
      serviceType: 'sortingContract',
      expectedValueHalalas: 2_400_000,
      attachmentIds: [],
      tags: [],
    });
    await changeStage(await reqOf(reem, 'sales.opportunities', 'edit'), String(oppContacted._id), {
      stage: 'contacted',
    });

    const quote = (customerId: unknown, itemId: unknown, quantity: number) =>
      createQuote(reemQuotes, {
        customerId: String(customerId),
        lines: [{ itemId: String(itemId), quantity }],
        attachmentIds: [],
      } as never);
    const sendIt = async (id: unknown) => {
      await submitQuote(reemQuotes, String(id));
      await sendQuote(reemQuotes, String(id), { to: ['purchasing@example.com'], cc: [], attachmentIds: [] });
    };
    await quote(gulf._id, plastic!._id, 2); // مسودة
    const qSent = await quote(municipality._id, visitSvc!._id, 12);
    await sendIt(qSent._id); // مرسل
    const qRejected = await quote(school._id, cardboard!._id, 1);
    await sendIt(qRejected._id);
    await respondQuote(reemQuotes, String(qRejected._id), {
      response: 'rejected',
      reason: 'السعر أعلى من المنافس',
    });
    const qNegotiating = await quote(gulf._id, visitSvc!._id, 24);
    await sendIt(qNegotiating._id);
    await respondQuote(reemQuotes, String(qNegotiating._id), {
      response: 'negotiating',
      note: 'العميل يطلب خصمًا على عدد الزيارات',
    });

    // An overdue invoice: majed's plastic sale, issued 40 days ago and due 10 days ago, nothing paid [SAL §14 (12)].
    const majedQuotes = await reqOf(majed, 'sales.quotes', 'create');
    const qSteel = await createQuote(majedQuotes, {
      customerId: String(steel._id),
      lines: [{ itemId: String(plastic!._id), quantity: 1 }],
      attachmentIds: [],
    } as never);
    await submitQuote(majedQuotes, String(qSteel._id));
    await sendQuote(majedQuotes, String(qSteel._id), {
      to: ['buy@steel.example'],
      cc: [],
      attachmentIds: [],
    });
    const acceptedSteel = await respondQuote(majedQuotes, String(qSteel._id), { response: 'accepted' });
    await registerInvoice(financeReq, {
      salesOrderId: String((acceptedSteel as { salesOrder?: { _id: unknown } }).salesOrder?._id),
      kind: 'tax',
      externalNumber: 'ERP-INV-2026-0098',
      issueDateTime: new Date(Date.now() - 40 * 86_400_000).toISOString(),
      dueDate: inDays(-10).slice(0, 10),
    });

    await createRequest(salesReq, {
      type: 'sortingContract',
      customerId: String(school._id),
      opportunityId: String(oppContacted._id),
      details: {
        contractType: 'فرز شهري',
        materialTypes: ['ورق', 'بلاستيك'],
        expectedQuantityKg: 4000,
        contractDurationMonths: 12,
      },
      attachmentIds: [],
      photoIds: [],
      tags: [],
    } as never);
    await createRequest(salesReq, {
      type: 'cleaningContract',
      customerId: String(gulf._id),
      details: { mode: 'provide_container', containerCount: 4, visitCount: 8, contractDurationMonths: 6 },
      attachmentIds: [],
      photoIds: [],
      tags: [],
    } as never);

    const ops = await Department.findOne({ code: 'ops' }).lean();
    if (ops) {
      const d2 = await openDiscussion(await reqOf(reem, 'discussions', 'create'), {
        recordType: 'sales_request',
        recordId: String(rnt._id),
        title: 'تأكيد عدد الحاويات قبل التسليم',
        details: 'العميل قد يرفع العدد إلى 5 حاويات؛ هل يتوفر ذلك في المستودع؟',
        targetDepartmentId: String(ops._id),
        participantUserIds: [],
        attachmentIds: [],
      });
      await setDiscussionState(await reqOf(khalid, 'discussions', 'view'), String(d2._id), 'awaiting_reply');
      await addMessage(
        await reqOf(khalid, 'discussions', 'view'),
        String(d2._id),
        'المتوفر 4 حاويات الآن؛ نحتاج تأكيد العدد النهائي من العميل.',
        [],
      );
    }
    if (finance) {
      const d3 = await openDiscussion(await reqOf(majed, 'discussions', 'create'), {
        recordType: 'customer',
        recordId: String(steel._id),
        title: 'تحديث الرقم الضريبي للعميل',
        details: 'العميل أرسل شهادة ضريبية جديدة.',
        targetDepartmentId: String(finance._id),
        participantUserIds: [],
        attachmentIds: [],
      });
      await setDiscussionState(
        await reqOf(abdulaziz, 'discussions', 'view'),
        String(d3._id),
        'resolved',
        'حُدّث الرقم في ملف الجهة',
      );
      await setDiscussionState(await reqOf(majed, 'discussions', 'view'), String(d3._id), 'closed');
    }

    // Meetings and visits in every SAL §9 status; one exhibition told Marketing.
    const event = async (
      owner: InstanceType<typeof User>,
      body: Record<string, unknown> & { title: string; startAt: Date },
    ) =>
      CalendarEvent.create({
        number: await nextNumber('event'),
        type: 'meeting',
        status: 'scheduled',
        endAt: new Date(body.startAt.getTime() + 3_600_000),
        ownerId: owner._id,
        participantIds: [],
        departmentIds: [sales._id],
        ...body,
      });
    const at = (days: number, hour: number) => {
      const d = new Date(`${inDays(days).slice(0, 10)}T00:00:00+03:00`);
      return new Date(d.getTime() + hour * 3_600_000);
    };
    const linkOf = (cust: { _id: unknown; number?: string; nameAr?: string }) => ({
      type: 'customer',
      id: String(cust._id),
      label: `${cust.number} — ${cust.nameAr}`,
    });
    await event(reem, {
      title: 'اجتماع مراجعة عرض الحاويات',
      startAt: at(1, 10),
      meetingType: 'حضوري',
      location: 'مقر شركة الخليج للتغليف',
      link: linkOf(gulf),
    });
    await event(majed, {
      title: 'زيارة معاينة السكراب',
      type: 'visit',
      status: 'done',
      startAt: at(-2, 9),
      outcome: 'الكمية أكبر من التقدير؛ يلزم شاحنتان',
      link: linkOf(steel),
    });
    await event(reem, {
      title: 'اجتماع إدارة المدارس',
      status: 'not_done',
      startAt: at(-1, 13),
      outcome: 'اعتذر العميل لظرف طارئ',
      link: linkOf(school),
    });
    await event(majed, {
      title: 'زيارة مطابع النور',
      type: 'visit',
      status: 'cancelled',
      startAt: at(3, 11),
      link: linkOf(stopped),
    });
    await event(reem, {
      title: 'معرض البيئة والاستدامة',
      type: 'event',
      status: 'rescheduled',
      startAt: at(12, 9),
      location: 'مركز الظهران للمعارض',
      organizer: 'غرفة الشرقية',
      needsMarketing: true,
      marketingNotifiedAt: new Date(),
    });

    const withdrawReq = await reqOf(sultan, 'sales.targets', 'edit');
    const temp = await setTarget(withdrawReq, {
      period,
      scope: 'user',
      userId: String(majed._id),
      dimension: 'service',
      dimensionKey: 'assetReturn',
      metric: 'revenue',
      value: 50_000_00,
    });
    await withdrawTarget(withdrawReq, String(temp._id), 'المناقصة أُجّلت إلى الربع القادم');
    const [py, pm] = period.split('-').map(Number);
    const previous = pm === 1 ? `${py - 1}-12` : `${py}-${String(pm - 1).padStart(2, '0')}`;
    await setTarget(withdrawReq, {
      period: previous,
      scope: 'department',
      dimension: 'none',
      metric: 'revenue',
      value: 380_000_00,
    });
  } catch (err) {
    logger.warn({ err }, 'seedSales: the S5 every-state sample was skipped');
  }

  return { customers: await Customer.countDocuments(), leads: await Lead.countDocuments() };
}
