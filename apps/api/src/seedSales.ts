import type { RoleAssignment } from '@eayni/shared';
import { User } from './core/auth/model';
import { Department } from './core/org/model';
import { effectivePermission } from './core/rbac/service';
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
    const eff = await effectivePermission(
      u.roles as RoleAssignment[],
      u.departmentId ? String(u.departmentId) : undefined,
      resource,
      action,
      String(u._id),
    );
    return {
      auth: {
        user: u,
        roleCodes: u.roles.map((r) => r.role),
        ip: '',
        userAgent: 'seed',
        requestId: 'seed',
        session: {} as never,
      },
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

  return { customers: await Customer.countDocuments(), leads: await Lead.countDocuments() };
}
