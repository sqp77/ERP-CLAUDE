import type { FilterQuery } from 'mongoose';
import {
  COLLECTION_STATE_AR,
  CUSTOMER_CLASSIFICATION_AR,
  CUSTOMER_CLASSIFICATIONS,
  CUSTOMER_SOURCE_AR,
  CUSTOMER_STATUS_AR,
  OPEN_TASK_STATUSES,
  OPPORTUNITY_STAGE_AR,
  PRICE_UNIT_AR,
  QUOTE_STATE_AR,
  SALES_REPORTS,
  SALES_SERVICE_TYPE_AR,
  salesReportFiltersSchema,
  type CustomerClassification,
  type CustomerSource,
  type CustomerStatus,
  type OpportunityStage,
  type PriceUnit,
  type QuoteState,
  type RoleAssignment,
  type SalesReportFilters,
  type SalesServiceType,
} from '@eayni/shared';
import { badRequest } from '../../core/http/errors';
import type { Authz, AuthedRequest } from '../../core/http/context';
import { registerExportResource, type ExportField } from '../../core/export/service';
import { roleCodesOf } from '../../core/rbac/service';
import { User } from '../../core/auth/model';
import { Task } from '../../core/tasks/model';
import { CalendarEvent } from '../../core/calendar/model';
import {
  riyadhDate,
  riyadhDayEndOf,
  riyadhDayStartOf,
  startOfRiyadhWeek,
} from '../../core/dates/businessDays';
import { periodDays, periodsBetween, riyadhPeriod } from '../../core/kpi/service';
import {
  countCustomers,
  customerLabels,
  customerListFilter,
  permissionOn,
  salesDepartmentId,
  userNames,
} from '../crm/service';
import { Customer } from '../crm/model';
import { anyInvoices, collectedInvoiceFacts, invoiceFacts } from '../finance/invoices.service';
import { Opportunity } from './model';
import { Quote } from './quotes.model';
import { opportunityListFilter } from './service';
import { quoteListFilter } from './quotes.service';
import { marketAverageBetween, revenueTarget } from './management.service';
import { PriceItem } from './pricing.model';

/**
 * Sales reports [SAL §12]: the five groups as export resources on the core export builder (field picker, preview,
 * Excel, PDF). Permission `sales.reports:export` (Sales manager: his department; executive: all). Every report reads
 * through the caller's own view permission on the underlying list (customers, opportunities, quotes, invoices) —
 * «مراعاة صلاحيات المستخدم عند استخراج البيانات» — and every financial figure comes from the Finance invoice register
 * (golden rule 5). Filters: period, employee, service, plus the report's own variant (segment / granularity).
 */

type Row = Record<string, unknown>;
const money = (key: string, labelAr: string): ExportField => ({
  key,
  labelAr: `${labelAr} (ر.س)`,
  kind: 'money',
  format: (v) => (typeof v === 'number' ? Math.round(v) / 100 : ''),
});
const tonsField = (key: string, labelAr = 'الكمية (طن)'): ExportField => ({
  key,
  labelAr,
  format: (v) => (typeof v === 'number' ? Math.round(v) / 1000 : ''),
});
const percent = (key: string, labelAr: string): ExportField => ({
  key,
  labelAr: `${labelAr} (%)`,
  format: (v) => (typeof v === 'number' ? Math.round(v) / 100 : ''),
});
const date = (key: string, labelAr: string): ExportField => ({ key, labelAr, kind: 'date' });
const plain = (key: string, labelAr: string): ExportField => ({ key, labelAr });

interface Ctx {
  req: AuthedRequest;
  f: SalesReportFilters & { from: string; to: string };
  start: Date;
  end: Date;
  limit: number;
}

/** The caller as a request, so the list filter builders apply his own scopes. */
async function contextOf(filters: Record<string, unknown>, userId: string, limit: number): Promise<Ctx> {
  const parsed = salesReportFiltersSchema.safeParse(filters);
  if (!parsed.success) throw badRequest('فلاتر التقرير غير صحيحة');
  const user = await User.findById(userId);
  if (!user) throw badRequest('المستخدم غير موجود');
  const dept = user.departmentId ? String(user.departmentId) : undefined;
  const req = {
    auth: { user, roleCodes: await roleCodesOf(user.roles as RoleAssignment[], dept) },
  } as unknown as AuthedRequest;
  const month = periodDays(riyadhPeriod());
  const from = parsed.data.from ?? month.from;
  const to = parsed.data.to ?? month.to;
  if (from > to) throw badRequest('بداية الفترة بعد نهايتها');
  return {
    req,
    f: { ...parsed.data, from, to },
    start: riyadhDayStartOf(from),
    end: riyadhDayEndOf(to),
    limit,
  };
}
const authzOf = (resource: string, eff: { scope: string; departmentIds: string[] }): Authz =>
  ({ resource, action: 'view', ...eff }) as Authz;

/** Invoices issued in the window (Finance data, read-only) through the caller's invoice permission. */
async function issuedInvoices(c: Ctx, extra: Record<string, unknown> = {}) {
  const eff = await permissionOn(c.req, 'finance.invoices', 'view');
  if (!eff || !(await anyInvoices())) return [];
  return invoiceFacts(c.req, eff, {
    issuedFrom: c.f.from,
    issuedTo: c.f.to,
    ownerUserId: c.f.ownerUserId,
    serviceType: c.f.serviceType,
    ...extra,
  });
}
type Facts = Awaited<ReturnType<typeof issuedInvoices>>;

const lineKg = (l: { unit?: string | null; quantity?: number | null }) =>
  l.unit === 'ton' ? Math.round((l.quantity ?? 0) * 1000) : l.unit === 'kg' ? Math.round(l.quantity ?? 0) : 0;

function periodKey(d: Date, g: 'day' | 'week' | 'month'): string {
  if (g === 'month') return riyadhDate(d).slice(0, 7);
  if (g === 'week') return riyadhDate(startOfRiyadhWeek(d));
  return riyadhDate(d);
}

/** Materials sold in the window: kg, revenue, quantities per unit, from invoice lines. */
async function materialRows(c: Ctx, facts: Facts) {
  const by = new Map<
    string,
    {
      itemId: string | null;
      nameAr: string;
      unit: string;
      quantity: number;
      kg: number;
      amount: number;
      invoices: Set<string>;
    }
  >();
  for (const f of facts)
    for (const l of f.lines ?? []) {
      const key = `${l.itemId ? String(l.itemId) : `d:${l.descriptionAr ?? ''}`}|${l.unit ?? ''}`;
      const m = by.get(key) ?? {
        itemId: l.itemId ? String(l.itemId) : null,
        nameAr: l.descriptionAr ?? '',
        unit: l.unit ?? '',
        quantity: 0,
        kg: 0,
        amount: 0,
        invoices: new Set<string>(),
      };
      m.quantity += l.quantity ?? 0;
      m.kg += lineKg(l);
      m.amount += l.lineTotalHalalas ?? 0;
      m.invoices.add(String(f._id));
      by.set(key, m);
    }
  const ids = [...new Set([...by.values()].map((m) => m.itemId).filter((x): x is string => !!x))];
  const items = ids.length
    ? await PriceItem.find({ _id: { $in: ids } })
        .select('nameAr')
        .lean()
    : [];
  const names = new Map(items.map((i) => [String(i._id), i.nameAr]));
  const market = ids.length ? await marketAverageBetween(ids, c.start, c.end) : null;
  return [...by.values()].map((m) => ({
    ...m,
    nameAr: (m.itemId && names.get(m.itemId)) || m.nameAr,
    marketPerTon: m.itemId ? (market?.averages.get(m.itemId) ?? null) : null,
  }));
}

const days = (from: Date, to: Date) => Math.round(((to.getTime() - from.getTime()) / 86_400_000) * 10) / 10;

// ------------------------------------------------------------------------------------------------
// The thirteen reports
// ------------------------------------------------------------------------------------------------
interface ReportDef {
  code: string;
  labelAr: string;
  fields: ExportField[];
  rows: (c: Ctx) => Promise<Row[]>;
}

const REPORTS: ReportDef[] = [
  // أولاً: تقارير المبيعات
  {
    code: 'sales_by_period',
    labelAr: 'تقرير المبيعات (يومي / أسبوعي / شهري)',
    fields: [
      plain('period', 'الفترة'),
      plain('invoices', 'عدد الفواتير'),
      money('subtotal', 'المبيعات قبل الضريبة'),
      money('vat', 'ضريبة القيمة المضافة'),
      money('total', 'الإجمالي'),
      money('collected', 'المحصّل'),
      tonsField('kg'),
    ],
    rows: async (c) => {
      const g = c.f.granularity ?? 'day';
      const by = new Map<
        string,
        Row & {
          invoices: number;
          subtotal: number;
          vat: number;
          total: number;
          collected: number;
          kg: number;
        }
      >();
      for (const f of await issuedInvoices(c)) {
        const k = periodKey(new Date(f.issueDateTime), g);
        const r = by.get(k) ?? { period: k, invoices: 0, subtotal: 0, vat: 0, total: 0, collected: 0, kg: 0 };
        r.invoices += 1;
        r.subtotal += f.subtotalHalalas ?? 0;
        r.vat += f.vatTotalHalalas ?? 0;
        r.total += f.totalHalalas ?? 0;
        r.collected += f.collectedHalalas ?? 0;
        r.kg += (f.lines ?? []).reduce((a, l) => a + lineKg(l), 0);
        by.set(k, r);
      }
      return [...by.values()].sort((a, b) => String(a.period).localeCompare(String(b.period)));
    },
  },
  {
    code: 'revenue_by_material',
    labelAr: 'الإيرادات حسب نوع المادة',
    fields: [
      plain('material', 'المادة'),
      tonsField('kg'),
      money('revenue', 'الإيراد قبل الضريبة'),
      percent('shareBp', 'النسبة من الإيرادات'),
      plain('invoices', 'عدد الفواتير'),
    ],
    rows: async (c) => {
      const mats = (await materialRows(c, await issuedInvoices(c))).filter((m) => m.itemId || m.kg);
      // Group units of one material together.
      const by = new Map<string, { material: string; kg: number; revenue: number; invoices: number }>();
      for (const m of mats) {
        const k = m.itemId ?? m.nameAr;
        const r = by.get(k) ?? { material: m.nameAr, kg: 0, revenue: 0, invoices: 0 };
        r.kg += m.kg;
        r.revenue += m.amount;
        r.invoices += m.invoices.size;
        by.set(k, r);
      }
      const total = [...by.values()].reduce((a, r) => a + r.revenue, 0);
      return [...by.values()]
        .map((r) => ({ ...r, shareBp: total ? Math.round((r.revenue * 10_000) / total) : 0 }))
        .sort((a, b) => b.revenue - a.revenue);
    },
  },
  {
    code: 'revenue_by_service',
    labelAr: 'الإيرادات حسب الخدمة',
    fields: [
      plain('service', 'الخدمة'),
      plain('invoices', 'عدد الفواتير'),
      money('subtotal', 'الإيراد قبل الضريبة'),
      money('total', 'الإجمالي'),
      money('collected', 'المحصّل'),
      percent('shareBp', 'النسبة من الإيرادات'),
    ],
    rows: async (c) => {
      const by = new Map<
        string,
        { service: string; invoices: number; subtotal: number; total: number; collected: number }
      >();
      for (const f of await issuedInvoices(c)) {
        const k = f.serviceType ?? '';
        const r = by.get(k) ?? {
          service: k ? SALES_SERVICE_TYPE_AR[k as SalesServiceType] : 'غير محدد',
          invoices: 0,
          subtotal: 0,
          total: 0,
          collected: 0,
        };
        r.invoices += 1;
        r.subtotal += f.subtotalHalalas ?? 0;
        r.total += f.totalHalalas ?? 0;
        r.collected += f.collectedHalalas ?? 0;
        by.set(k, r);
      }
      const sum = [...by.values()].reduce((a, r) => a + r.subtotal, 0);
      return [...by.values()]
        .map((r) => ({ ...r, shareBp: sum ? Math.round((r.subtotal * 10_000) / sum) : 0 }))
        .sort((a, b) => b.subtotal - a.subtotal);
    },
  },
  {
    code: 'quantities',
    labelAr: 'الكميات المباعة',
    fields: [
      plain('material', 'المادة أو الخدمة'),
      plain('unit', 'الوحدة'),
      plain('quantity', 'الكمية بالوحدة'),
      tonsField('kg', 'المكافئ بالطن'),
      plain('invoices', 'عدد الفواتير'),
    ],
    rows: async (c) =>
      (await materialRows(c, await issuedInvoices(c)))
        .map((m) => ({
          material: m.nameAr,
          unit: PRICE_UNIT_AR[m.unit as PriceUnit] ?? m.unit,
          quantity: m.quantity,
          kg: m.kg || null,
          invoices: m.invoices.size,
        }))
        .sort((a, b) => (b.kg ?? 0) - (a.kg ?? 0)),
  },
  {
    code: 'avg_prices',
    labelAr: 'متوسط أسعار البيع',
    fields: [
      plain('material', 'المادة أو الخدمة'),
      plain('unit', 'الوحدة'),
      money('avgUnitPrice', 'متوسط سعر الوحدة'),
      money('avgPerTon', 'متوسط سعر الطن'),
      money('marketPerTon', 'متوسط سعر السوق للطن'),
      percent('vsMarketBp', 'الفرق عن السوق'),
    ],
    rows: async (c) =>
      (await materialRows(c, await issuedInvoices(c))).map((m) => {
        const perTon = m.kg ? Math.round((m.amount * 1000) / m.kg) : null;
        return {
          material: m.nameAr,
          unit: PRICE_UNIT_AR[m.unit as PriceUnit] ?? m.unit,
          avgUnitPrice: m.quantity ? Math.round(m.amount / m.quantity) : null,
          avgPerTon: perTon,
          marketPerTon: m.marketPerTon,
          vsMarketBp:
            perTon !== null && m.marketPerTon
              ? Math.round(((perTon - m.marketPerTon) * 10_000) / m.marketPerTon)
              : null,
        };
      }),
  },

  // ثانياً: تقارير العملاء
  {
    code: 'customers',
    labelAr: 'العملاء (قاعدة البيانات / الجدد / النشطون / غير المتعاونين)',
    fields: [
      plain('number', 'رقم العميل'),
      plain('nameAr', 'اسم العميل'),
      plain('status', 'الحالة'),
      plain('classification', 'التصنيف'),
      plain('source', 'المصدر'),
      plain('organizationType', 'نوع الجهة'),
      plain('region', 'المنطقة'),
      plain('city', 'المدينة'),
      plain('owner', 'الموظف المسؤول'),
      plain('phone', 'الهاتف'),
      plain('email', 'البريد الإلكتروني'),
      date('createdAt', 'تاريخ التسجيل'),
      date('lastContactAt', 'آخر تواصل'),
      date('nextFollowUpAt', 'المتابعة القادمة'),
      plain('tags', 'الوسوم'),
    ],
    rows: async (c) => {
      const eff = await permissionOn(c.req, 'crm.customers', 'view');
      if (!eff) return [];
      const seg = c.f.segment ?? 'all';
      const q: Record<string, unknown> = { ownerUserId: c.f.ownerUserId };
      if (seg === 'new') Object.assign(q, { createdFrom: c.f.from, createdTo: c.f.to });
      if (seg === 'active') q.status = 'active';
      const filter: FilterQuery<unknown> = customerListFilter(
        c.req.auth.user,
        authzOf('crm.customers', eff),
        q as never,
      );
      // «غير المتعاونين» = غير مهتم + متوقف عن التعامل (DECISIONS §20 S5).
      if (seg === 'not_cooperating') filter.status = { $in: ['not_interested', 'stopped'] };
      if (c.f.classification && (CUSTOMER_CLASSIFICATIONS as readonly string[]).includes(c.f.classification))
        filter.classification = c.f.classification;
      const rows = await Customer.find(filter).sort({ createdAt: -1 }).limit(c.limit).lean();
      const owners = await userNames(rows.map((r) => r.ownerUserId));
      return rows.map((r) => ({
        number: r.number,
        nameAr: r.nameAr,
        status: CUSTOMER_STATUS_AR[r.status as CustomerStatus] ?? r.status,
        classification: r.classification
          ? CUSTOMER_CLASSIFICATION_AR[r.classification as CustomerClassification]
          : '',
        source: CUSTOMER_SOURCE_AR[r.source as CustomerSource] ?? r.source,
        organizationType: r.organizationType ?? '',
        region: r.region ?? '',
        city: r.city ?? '',
        owner: owners.get(String(r.ownerUserId)) ?? '',
        phone: r.phone ?? '',
        email: r.email ?? '',
        createdAt: (r as { createdAt?: Date }).createdAt,
        lastContactAt: r.lastContactAt,
        nextFollowUpAt: r.nextFollowUpAt,
        tags: (r.tags ?? []).join('، '),
      }));
    },
  },
  {
    code: 'customers_by_classification',
    labelAr: 'تصنيف العملاء حسب الأهمية',
    fields: [
      plain('classification', 'التصنيف'),
      plain('customers', 'عدد العملاء'),
      plain('active', 'منهم نشطون'),
      money('revenue', 'إيرادات الفترة قبل الضريبة'),
    ],
    rows: async (c) => {
      const eff = await permissionOn(c.req, 'crm.customers', 'view');
      if (!eff) return [];
      const base = customerListFilter(c.req.auth.user, authzOf('crm.customers', eff), {
        ownerUserId: c.f.ownerUserId,
      });
      const facts = await issuedInvoices(c);
      const ids = [...new Set(facts.map((f) => String(f.customerId)))];
      const classOf = new Map(
        (
          await Customer.find({ _id: { $in: ids } })
            .select('classification')
            .lean()
        ).map((x) => [String(x._id), x.classification ?? '']),
      );
      const revenue = new Map<string, number>();
      for (const f of facts) {
        const k = classOf.get(String(f.customerId)) ?? '';
        revenue.set(k, (revenue.get(k) ?? 0) + (f.subtotalHalalas ?? 0));
      }
      const out: Row[] = [];
      for (const k of [...CUSTOMER_CLASSIFICATIONS, ''] as string[]) {
        const filter = { ...base, classification: k ? k : { $in: [null, ''] } };
        out.push({
          classification: k ? CUSTOMER_CLASSIFICATION_AR[k as CustomerClassification] : 'غير مصنف',
          customers: await countCustomers(filter),
          active: await countCustomers({ ...filter, status: 'active' }),
          revenue: revenue.get(k) ?? 0,
        });
      }
      return out;
    },
  },

  // ثالثاً: تقارير الفرص البيعية
  {
    code: 'opportunities',
    labelAr: 'الفرص البيعية (الجديدة / قيد المعالجة / الناجحة / الخاسرة)',
    fields: [
      plain('number', 'رقم الفرصة'),
      plain('title', 'العنوان'),
      plain('customer', 'العميل'),
      plain('stage', 'المرحلة'),
      plain('service', 'الخدمة'),
      money('expectedValue', 'القيمة المتوقعة'),
      plain('owner', 'الموظف المسؤول'),
      date('createdAt', 'تاريخ الإنشاء'),
      date('closedAt', 'تاريخ الإغلاق'),
      plain('lostReason', 'سبب الخسارة'),
    ],
    rows: async (c) => {
      const eff = await permissionOn(c.req, 'sales.opportunities', 'view');
      if (!eff) return [];
      const seg = c.f.segment ?? 'new';
      const q: Record<string, unknown> = { ownerUserId: c.f.ownerUserId, serviceType: c.f.serviceType };
      if (seg === 'new') Object.assign(q, { createdFrom: c.f.from, createdTo: c.f.to });
      if (seg === 'in_progress') q.stage = 'in_progress';
      if (seg === 'won' || seg === 'lost')
        Object.assign(q, { stage: seg, closedFrom: c.f.from, closedTo: c.f.to });
      const rows = await Opportunity.find(
        opportunityListFilter(c.req.auth.user, authzOf('sales.opportunities', eff), q as never),
      )
        .sort({ createdAt: -1 })
        .limit(c.limit)
        .lean();
      const [owners, customers] = await Promise.all([
        userNames(rows.map((r) => r.ownerUserId)),
        customerLabels(rows.map((r) => r.customerId)),
      ]);
      return rows.map((r) => ({
        number: r.number,
        title: r.title,
        customer: customers.get(String(r.customerId))?.nameAr ?? '',
        stage: OPPORTUNITY_STAGE_AR[r.stage as OpportunityStage] ?? r.stage,
        service: r.serviceType ? SALES_SERVICE_TYPE_AR[r.serviceType as SalesServiceType] : '',
        expectedValue: r.expectedValueHalalas ?? null,
        owner: owners.get(String(r.ownerUserId)) ?? '',
        createdAt: (r as { createdAt?: Date }).createdAt,
        closedAt: r.wonAt ?? r.lostAt ?? null,
        lostReason: r.lostReason ?? '',
      }));
    },
  },
  {
    code: 'quotes',
    labelAr: 'العروض السعرية (المرسلة / المقبولة / المرفوضة)',
    fields: [
      plain('number', 'رقم العرض'),
      plain('version', 'النسخة'),
      plain('customer', 'العميل'),
      plain('state', 'الحالة'),
      money('total', 'الإجمالي'),
      date('sentAt', 'تاريخ الإرسال'),
      date('respondedAt', 'تاريخ رد العميل'),
      plain('rejectionReason', 'سبب الرفض'),
      plain('owner', 'الموظف المسؤول'),
    ],
    rows: async (c) => {
      const eff = await permissionOn(c.req, 'sales.quotes', 'view');
      if (!eff) return [];
      const seg = c.f.segment ?? 'sent';
      // One offer per revision chain (the newest version), sent in the period — as the conversion KPI counts it.
      const filter = quoteListFilter(c.req, eff, {
        sentFrom: c.f.from,
        sentTo: c.f.to,
        latest: true,
        ownerUserId: c.f.ownerUserId,
        ...(seg === 'accepted' || seg === 'rejected' ? { state: seg } : {}),
      });
      const rows = await Quote.find(filter).sort({ sentAt: -1 }).limit(c.limit).lean();
      const [owners, customers] = await Promise.all([
        userNames(rows.map((r) => r.ownerUserId)),
        customerLabels(rows.map((r) => r.customerId)),
      ]);
      return rows.map((r) => ({
        number: r.number,
        version: r.version ?? 1,
        customer: customers.get(String(r.customerId))?.nameAr ?? '',
        state: QUOTE_STATE_AR[r.state as QuoteState] ?? r.state,
        total: r.totalHalalas,
        sentAt: r.sentAt,
        respondedAt: r.customerResponse?.at ?? null,
        rejectionReason: r.state === 'rejected' ? (r.customerResponse?.reason ?? '') : '',
        owner: owners.get(String(r.ownerUserId)) ?? '',
      }));
    },
  },
  {
    code: 'loss_reasons',
    labelAr: 'أسباب خسارة الفرص',
    fields: [
      plain('reason', 'سبب الخسارة'),
      plain('count', 'عدد الفرص'),
      percent('shareBp', 'النسبة'),
      money('value', 'القيمة المتوقعة المفقودة'),
    ],
    rows: async (c) => {
      const eff = await permissionOn(c.req, 'sales.opportunities', 'view');
      if (!eff) return [];
      const rows = await Opportunity.find(
        opportunityListFilter(c.req.auth.user, authzOf('sales.opportunities', eff), {
          stage: 'lost',
          closedFrom: c.f.from,
          closedTo: c.f.to,
          ownerUserId: c.f.ownerUserId,
          serviceType: c.f.serviceType,
        }),
      )
        .select('lostReason expectedValueHalalas')
        .lean();
      const by = new Map<string, { reason: string; count: number; value: number }>();
      for (const r of rows) {
        const k = r.lostReason?.trim() || 'غير مذكور';
        const x = by.get(k) ?? { reason: k, count: 0, value: 0 };
        x.count += 1;
        x.value += r.expectedValueHalalas ?? 0;
        by.set(k, x);
      }
      return [...by.values()]
        .map((x) => ({ ...x, shareBp: rows.length ? Math.round((x.count * 10_000) / rows.length) : 0 }))
        .sort((a, b) => b.count - a.count);
    },
  },

  // رابعاً: تقارير الموظفين
  {
    code: 'employees',
    labelAr: 'أداء الموظفين',
    fields: [
      plain('employee', 'الموظف'),
      plain('customersRegistered', 'العملاء المسجلون'),
      plain('meetingsVisits', 'الزيارات والاجتماعات المنجزة'),
      plain('quotesSent', 'العروض المرسلة'),
      money('achieved', 'المبيعات المحققة قبل الضريبة'),
      money('target', 'المستهدف'),
      percent('achievementBp', 'نسبة تحقيق المستهدف'),
      plain('tasksDone', 'المهام المنجزة'),
      plain('tasksOpen', 'المهام غير المنجزة'),
    ],
    rows: async (c) => {
      const salesDept = await salesDepartmentId();
      const scope = await permissionOn(c.req, 'sales.reports', 'export');
      const members = await User.find({
        departmentId: salesDept,
        deletedAt: null,
        ...(c.f.ownerUserId ? { _id: c.f.ownerUserId } : { status: 'active' }),
      })
        .select('displayNameAr')
        .sort({ displayNameAr: 1 })
        .lean();
      if (!scope || (scope.scope !== 'all' && !scope.departmentIds.includes(salesDept))) return [];
      const [custEff, quoteEff] = await Promise.all([
        permissionOn(c.req, 'crm.customers', 'view'),
        permissionOn(c.req, 'sales.quotes', 'view'),
      ]);
      const facts = await issuedInvoices(c, { ownerUserId: undefined });
      const periods = periodsBetween(c.f.from.slice(0, 7), c.f.to.slice(0, 7));
      const out: Row[] = [];
      for (const m of members) {
        const uid = String(m._id);
        const achieved = facts
          .filter((f) => String(f.salesOwnerUserId) === uid)
          .reduce((a, f) => a + (f.subtotalHalalas ?? 0), 0);
        // The target of the months the period touches (monthly targets, SAL §11.1).
        let target: number | null = null;
        for (const p of periods) {
          const v = await revenueTarget(p, { userId: uid });
          if (v !== null) target = (target ?? 0) + v;
        }
        const window = { $gte: c.start, $lte: c.end };
        const [customersRegistered, meetingsVisits, quotesSent, tasksDone, tasksOpen] = await Promise.all([
          custEff
            ? countCustomers({
                ...customerListFilter(c.req.auth.user, authzOf('crm.customers', custEff), {}),
                createdByUserId: m._id,
                createdAt: window,
              })
            : 0,
          CalendarEvent.countDocuments({
            deletedAt: null,
            type: { $in: ['meeting', 'visit'] },
            status: 'done',
            startAt: window,
            $or: [{ ownerId: m._id }, { participantIds: m._id }],
          }),
          quoteEff
            ? Quote.countDocuments(
                quoteListFilter(c.req, quoteEff, {
                  sentFrom: c.f.from,
                  sentTo: c.f.to,
                  latest: true,
                  ownerUserId: uid,
                }),
              )
            : 0,
          Task.countDocuments({ assigneeId: m._id, status: 'done', completedAt: window, deletedAt: null }),
          Task.countDocuments({ assigneeId: m._id, status: { $in: OPEN_TASK_STATUSES }, deletedAt: null }),
        ]);
        out.push({
          employee: m.displayNameAr ?? '',
          customersRegistered,
          meetingsVisits,
          quotesSent,
          achieved,
          target,
          achievementBp: target ? Math.round((achieved * 10_000) / target) : null,
          tasksDone,
          tasksOpen,
        });
      }
      return out;
    },
  },

  // خامساً: التقارير المالية
  {
    code: 'invoices',
    labelAr: 'الفواتير (الصادرة / المسددة / غير المسددة / المتأخرة)',
    fields: [
      plain('number', 'رقم الفاتورة في النظام'),
      plain('externalNumber', 'رقم الفاتورة الصادرة'),
      plain('customer', 'العميل'),
      plain('service', 'الخدمة'),
      date('issueDate', 'تاريخ الإصدار'),
      date('dueDate', 'تاريخ الاستحقاق'),
      money('subtotal', 'قبل الضريبة'),
      money('vat', 'الضريبة'),
      money('total', 'الإجمالي'),
      money('collected', 'المحصّل'),
      money('remaining', 'المبلغ المستحق'),
      plain('state', 'حالة التحصيل'),
      plain('collectionDays', 'مدة التحصيل (يوم)'),
      plain('owner', 'الموظف المسؤول'),
    ],
    rows: async (c) => {
      const seg = c.f.segment ?? 'all';
      const facts = await issuedInvoices(c, {
        ...(seg === 'paid' ? { collectionState: 'collected' } : {}),
        ...(seg === 'unpaid' ? { unpaid: true } : {}),
        ...(seg === 'overdue' ? { overdue: true } : {}),
      });
      const owners = await userNames(facts.map((f) => f.salesOwnerUserId));
      return facts
        .sort((a, b) => new Date(b.issueDateTime).getTime() - new Date(a.issueDateTime).getTime())
        .slice(0, c.limit)
        .map((f) => {
          const last = f.payments?.length
            ? Math.max(...f.payments.map((p) => new Date(p.paidAt).getTime()))
            : null;
          return {
            number: f.number,
            externalNumber: f.externalNumber,
            customer: f.customer?.nameAr ?? '',
            service: f.serviceType ? SALES_SERVICE_TYPE_AR[f.serviceType as SalesServiceType] : '',
            issueDate: f.issueDateTime,
            dueDate: f.dueDate,
            subtotal: f.subtotalHalalas,
            vat: f.vatTotalHalalas,
            total: f.totalHalalas,
            collected: f.collectedHalalas,
            remaining: f.remainingHalalas,
            state:
              COLLECTION_STATE_AR[f.collectionState as keyof typeof COLLECTION_STATE_AR] ?? f.collectionState,
            collectionDays:
              f.collectionState === 'collected' && last
                ? days(new Date(f.issueDateTime), new Date(last))
                : '',
            owner: owners.get(String(f.salesOwnerUserId)) ?? '',
          };
        });
    },
  },
  {
    code: 'financial_summary',
    labelAr: 'الملخص المالي',
    fields: [
      plain('invoices', 'عدد الفواتير الصادرة'),
      money('total', 'إجمالي الفواتير الصادرة'),
      plain('paid', 'الفواتير المسددة'),
      money('paidAmount', 'المبالغ المسددة'),
      plain('unpaid', 'الفواتير غير المسددة'),
      money('outstanding', 'المبالغ المستحقة'),
      plain('overdue', 'الفواتير المتأخرة'),
      money('overdueAmount', 'المبالغ المتأخرة'),
      plain('avgCollectionDays', 'متوسط مدة التحصيل (يوم)'),
    ],
    rows: async (c) => {
      const eff = await permissionOn(c.req, 'finance.invoices', 'view');
      const issued = await issuedInvoices(c);
      const overdue = issued.filter(
        (f) => (f.remainingHalalas ?? 0) > 0 && new Date(f.dueDate).getTime() < Date.now(),
      );
      const collected =
        eff && (await anyInvoices())
          ? await collectedInvoiceFacts(c.req, eff, c.start, new Date(c.end.getTime() + 1), {
              ownerUserId: c.f.ownerUserId,
              serviceType: c.f.serviceType,
            })
          : [];
      const avg = collected.length
        ? Math.round(
            (collected.reduce(
              (a, x) => a + (x.lastPaidAt.getTime() - new Date(x.issueDateTime).getTime()),
              0,
            ) /
              collected.length /
              86_400_000) *
              10,
          ) / 10
        : '';
      const paid = issued.filter((f) => f.collectionState === 'collected');
      const unpaid = issued.filter((f) => (f.remainingHalalas ?? 0) > 0);
      const sum = (rows: typeof issued, k: 'totalHalalas' | 'collectedHalalas' | 'remainingHalalas') =>
        rows.reduce((a, r) => a + (r[k] ?? 0), 0);
      return [
        {
          invoices: issued.length,
          total: sum(issued, 'totalHalalas'),
          paid: paid.length,
          paidAmount: sum(issued, 'collectedHalalas'),
          unpaid: unpaid.length,
          outstanding: sum(unpaid, 'remainingHalalas'),
          overdue: overdue.length,
          overdueAmount: sum(overdue, 'remainingHalalas'),
          avgCollectionDays: avg,
        },
      ];
    },
  },
];

export const SALES_REPORT_RESOURCE = (code: string) => `sales.report.${code}`;

/** Registers the reports on the core export builder; the catalog order follows SAL §12. */
export function registerSalesReports(): void {
  const known = new Set(SALES_REPORTS.map((r) => r.code));
  for (const def of REPORTS) {
    if (!known.has(def.code)) throw new Error(`sales report ${def.code} missing from SALES_REPORTS`);
    registerExportResource({
      resource: SALES_REPORT_RESOURCE(def.code),
      labelAr: def.labelAr,
      permissionResource: 'sales.reports',
      fields: def.fields,
      query: async ({ filters, userId, limit }) => def.rows(await contextOf(filters, userId, limit)),
    });
  }
}
