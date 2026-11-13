import { Types, type FilterQuery } from 'mongoose';
import {
  OPEN_OPPORTUNITY_STAGES,
  OPEN_TASK_STATUSES,
  SALES_KPI_AR,
  type CreateLibraryDocInput,
  type SalesKpiCode,
  type SalesKpiQuery,
  type SetSalesTargetInput,
} from '@eayni/shared';
import { badRequest, conflict, forbidden, notFound } from '../../core/http/errors';
import { actorFrom, type Authz, type AuthedRequest } from '../../core/http/context';
import { recordAudit } from '../../core/audit/service';
import { notify } from '../../core/notifications/service';
import { getSetting } from '../../core/settings/service';
import { claimAttachments } from '../../core/files/service';
import { Attachment } from '../../core/files/model';
import { User } from '../../core/auth/model';
import { Task } from '../../core/tasks/model';
import { CalendarEvent } from '../../core/calendar/model';
import { riyadhDate } from '../../core/dates/businessDays';
import {
  achievementBp,
  kpiValue,
  periodBounds,
  periodDays,
  periodsBetween,
  riyadhPeriod,
  type KpiValue,
} from '../../core/kpi/service';
import { withTransaction } from '../../db';
import {
  assertSalesTarget,
  countCustomers,
  customerListFilter,
  permissionOn,
  salesDepartmentId,
  userNames,
} from '../crm/service';
import {
  anyInvoices,
  collectedInvoiceFacts,
  invoiceFacts,
  invoiceListFilter,
} from '../finance/invoices.service';
import { Opportunity } from './model';
import { Quote } from './quotes.model';
import { MarketPrice, PriceItem } from './pricing.model';
import { opportunityListFilter } from './service';
import { quoteListFilter } from './quotes.service';
import { SalesLibraryDoc, SalesTargetVersion } from './management.model';

/**
 * Sales S4 — management and follow-up [SAL §17 المرحلة الرابعة]: monthly targets with versions (§11.1), the five KPIs and
 * the KPI board (§11, §11.2), the Sales dashboard (§13) with read-only budget cards (§8.3) and the documents library
 * (§8.2). Financial figures come from the Finance invoice register only (golden rule 5); nothing here is typed in.
 * Every dashboard card is computed with the same filter its list uses, and carries the link of that list.
 */

type Eff = { scope: string; departmentIds: string[] };
const authzOf = (resource: string, action: string, eff: Eff): Authz =>
  ({ resource, action, ...eff }) as Authz;

/** A list link with its filter (one number, one list). Every path here is a web route (/sales/…). */
const listLink = (path: string, params: Record<string, string | number | boolean | undefined | null>) =>
  `${path}${qs(params)}`;
const qs = (params: Record<string, string | number | boolean | undefined | null>) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params))
    if (v !== undefined && v !== null && v !== '') u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : '';
};

/** Kilograms in an invoice line: tons and kilograms count, other units (pieces, visits…) do not [SAL §11 «طن»]. */
function lineKg(l: { unit?: string | null; quantity?: number | null }): number {
  const q = l.quantity ?? 0;
  if (l.unit === 'ton') return Math.round(q * 1000);
  if (l.unit === 'kg') return Math.round(q);
  return 0;
}

// ------------------------------------------------------------------------------------------------
// Targets [SAL §11.1]
// ------------------------------------------------------------------------------------------------
const targetKey = (t: {
  period: string;
  scope: string;
  userId?: string | null;
  dimension?: string | null;
  dimensionKey?: string | null;
  metric?: string | null;
}) =>
  [
    t.period,
    t.scope,
    t.userId ?? '-',
    t.dimension ?? 'none',
    t.dimensionKey ?? '-',
    t.metric ?? 'revenue',
  ].join('|');

async function targetEditPermission(req: AuthedRequest): Promise<{ eff: Eff; salesDept: string }> {
  const eff = await permissionOn(req, 'sales.targets', 'edit');
  if (!eff || eff.scope === 'own' || eff.scope === 'team')
    throw forbidden('تحديد المستهدفات من صلاحيات مدير المبيعات');
  const salesDept = await salesDepartmentId();
  if (eff.scope === 'department' && !eff.departmentIds.includes(salesDept)) throw forbidden();
  return { eff, salesDept };
}

/** Set or change a monthly target: always a NEW version; a change needs a reason [SAL §11.1]. */
export async function setTarget(req: AuthedRequest, input: SetSalesTargetInput) {
  const { eff, salesDept } = await targetEditPermission(req);
  if (input.scope === 'user') await assertSalesTarget(authzOf('sales.targets', 'edit', eff), input.userId!);
  const key = targetKey(input);
  const last = await SalesTargetVersion.findOne({ key }).sort({ version: -1 }).lean();
  if (last && !input.reason?.trim())
    throw badRequest('سبب التعديل مطلوب', [{ path: 'reason', message: 'اذكر سبب تعديل المستهدف' }]);
  if (last && !last.withdrawn && last.value === input.value) throw badRequest('القيمة لم تتغير');
  const doc = await createVersion({
    key,
    period: input.period,
    scope: input.scope,
    userId: input.userId,
    departmentId: salesDept,
    dimension: input.dimension,
    dimensionKey: input.dimensionKey,
    metric: input.metric,
    value: input.value,
    previousValue: last && !last.withdrawn ? last.value : null,
    version: (last?.version ?? 0) + 1,
    withdrawn: false,
    reason: input.reason?.trim(),
    req,
  });
  if (input.scope === 'user' && input.userId !== String(req.auth.user._id))
    await notify({
      userIds: [input.userId!],
      type: 'sales.target.changed',
      bodyAr: `${input.period}: ${input.metric === 'quantity' ? `${(input.value / 1000).toLocaleString('ar-SA-u-nu-latn')} طن` : `${(input.value / 100).toLocaleString('ar-SA-u-nu-latn')} ر.س`}${input.reason ? ` — ${input.reason}` : ''}`,
      link: `/sales/targets?period=${input.period}`,
    });
  return doc;
}

/** Withdraw a target: a new version that keeps the old value and says why [SAL §11.1 «أي تعديل أو سحب»]. */
export async function withdrawTarget(req: AuthedRequest, versionId: string, reason: string) {
  await targetEditPermission(req);
  const row = await SalesTargetVersion.findById(versionId).lean();
  if (!row) throw notFound();
  const last = await SalesTargetVersion.findOne({ key: row.key }).sort({ version: -1 }).lean();
  if (!last || last.withdrawn) throw conflict('المستهدف مسحوب مسبقًا');
  return createVersion({
    key: row.key,
    period: row.period,
    scope: row.scope,
    userId: row.userId ? String(row.userId) : undefined,
    departmentId: String(row.departmentId),
    dimension: row.dimension ?? 'none',
    dimensionKey: row.dimensionKey ?? undefined,
    metric: row.metric ?? 'revenue',
    value: last.value,
    previousValue: last.value,
    version: last.version + 1,
    withdrawn: true,
    reason: reason.trim(),
    req,
  });
}

async function createVersion(v: {
  key: string;
  period: string;
  scope: string;
  userId?: string;
  departmentId: string;
  dimension: string;
  dimensionKey?: string;
  metric: string;
  value: number;
  previousValue: number | null;
  version: number;
  withdrawn: boolean;
  reason?: string;
  req: AuthedRequest;
}) {
  const { req, ...data } = v;
  try {
    return await withTransaction(async (session) => {
      const [doc] = await SalesTargetVersion.create(
        [{ ...data, byUserId: req.auth.user._id, byName: req.auth.user.displayNameAr, at: new Date() }],
        { session, ordered: true },
      );
      await recordAudit(
        actorFrom(req),
        {
          action: v.withdrawn ? 'delete' : v.version > 1 ? 'update' : 'create',
          resource: 'sales.targets',
          resourceId: String(doc._id),
          before: v.version > 1 ? { value: v.previousValue } : undefined,
          after: { key: v.key, value: v.value, version: v.version, withdrawn: v.withdrawn, reason: v.reason },
        },
        session,
      );
      return doc.toObject();
    });
  } catch (err) {
    if ((err as { code?: number }).code === 11000)
      throw conflict('عدّل شخص آخر هذا المستهدف في الوقت نفسه، حدّث الصفحة');
    throw err;
  }
}

/** Current (latest, not withdrawn) target per key for the given periods and filter. */
async function currentTargets(filter: FilterQuery<unknown>) {
  const rows = await SalesTargetVersion.find(filter).sort({ key: 1, version: -1 }).lean();
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!latest.has(r.key)) latest.set(r.key, r);
  return { latest: [...latest.values()].filter((r) => !r.withdrawn), all: rows };
}

/** Invoice facts of one period in the caller's scope (null when the caller can't read invoices). */
async function periodFacts(req: AuthedRequest, period: string, serviceType?: string) {
  const eff = await permissionOn(req, 'finance.invoices', 'view');
  if (!eff) return null;
  const days = periodDays(period);
  return invoiceFacts(req, eff, { issuedFrom: days.from, issuedTo: days.to, serviceType });
}
type Facts = NonNullable<Awaited<ReturnType<typeof periodFacts>>>;

/** Achievement of a target from Finance invoice data: revenue before VAT or kilograms, by rep / service / material. */
function achievedFrom(
  facts: Facts,
  t: {
    scope: string;
    userId?: unknown;
    dimension?: string | null;
    dimensionKey?: string | null;
    metric?: string | null;
  },
): number {
  let total = 0;
  for (const inv of facts) {
    if (t.scope === 'user' && String(inv.salesOwnerUserId) !== String(t.userId)) continue;
    if (t.dimension === 'service' && inv.serviceType !== t.dimensionKey) continue;
    if (t.dimension === 'material' || t.metric === 'quantity') {
      for (const l of inv.lines ?? []) {
        if (t.dimension === 'material' && String(l.itemId ?? '') !== t.dimensionKey) continue;
        total += t.metric === 'quantity' ? lineKg(l) : (l.lineTotalHalalas ?? 0);
      }
    } else total += inv.subtotalHalalas ?? 0;
  }
  return total;
}

export async function listTargets(
  req: AuthedRequest,
  q: { period?: string; from?: string; to?: string; userId?: string },
) {
  const eff = await permissionOn(req, 'sales.targets', 'view');
  if (!eff) throw forbidden();
  const periods = q.from && q.to ? periodsBetween(q.from, q.to) : [q.period ?? riyadhPeriod()];
  const filter: FilterQuery<unknown> = { period: { $in: periods } };
  if (eff.scope === 'own' || eff.scope === 'team') {
    // A rep follows his own targets only [SAL §15 «متابعة المهام والمستهدفات الخاصة به»].
    filter.scope = 'user';
    filter.userId = req.auth.user._id;
  } else {
    if (eff.scope === 'department')
      filter.departmentId = { $in: eff.departmentIds.map((d) => new Types.ObjectId(d)) };
    if (q.userId) filter.userId = new Types.ObjectId(q.userId);
  }
  const { latest, all } = await currentTargets(filter);
  const factsByPeriod = new Map<string, Facts | null>();
  for (const p of periods) factsByPeriod.set(p, await periodFacts(req, p));
  const names = await userNames([...all.map((r) => r.userId), ...all.map((r) => r.byUserId)]);
  const items = await Promise.all(
    latest.map(async (t) => {
      const facts = factsByPeriod.get(t.period) ?? null;
      const achieved = facts ? achievedFrom(facts, t) : null;
      return {
        ...t,
        userName: t.userId ? names.get(String(t.userId)) : undefined,
        dimensionLabel:
          t.dimension === 'material' && t.dimensionKey
            ? ((await PriceItem.findById(t.dimensionKey).select('nameAr').lean())?.nameAr ?? t.dimensionKey)
            : undefined,
        achieved,
        achievementBp: achieved === null ? null : achievementBp(achieved, t.value),
        met: achieved === null ? null : achieved >= t.value,
        history: all
          .filter((h) => h.key === t.key)
          .map((h) => ({ ...h, byName: h.byName ?? names.get(String(h.byUserId)) })),
      };
    }),
  );
  // Withdrawn keys stay visible in the history so nothing disappears silently.
  const withdrawn = [...new Set(all.filter((r) => r.withdrawn).map((r) => r.key))]
    .filter((k) => !latest.some((l) => l.key === k))
    .map((k) => all.filter((h) => h.key === k));
  return {
    periods,
    financeDataAvailable: await anyInvoices(),
    items: items.sort((a, b) => a.period.localeCompare(b.period) || a.scope.localeCompare(b.scope)),
    withdrawn,
  };
}

async function revenueTarget(
  period: string,
  scope: { userId?: string; serviceType?: string },
  metric: 'revenue' | 'quantity' = 'revenue',
): Promise<number | null> {
  const key = targetKey({
    period,
    scope: scope.userId ? 'user' : 'department',
    userId: scope.userId,
    dimension: scope.serviceType ? 'service' : 'none',
    dimensionKey: scope.serviceType,
    metric,
  });
  const last = await SalesTargetVersion.findOne({ key }).sort({ version: -1 }).lean();
  return last && !last.withdrawn ? last.value : null;
}

// ------------------------------------------------------------------------------------------------
// KPIs [SAL §11, §11.2]
// ------------------------------------------------------------------------------------------------
async function marketAverageForPeriod(itemIds: string[], period: string) {
  const { from, to } = periodBounds(period);
  // Weeks are Riyadh Sundays; a week that starts in the last six days of the previous month still covers this one.
  const fromWeek = riyadhDate(new Date(from.getTime() - 6 * 86_400_000));
  const toWeek = riyadhDate(new Date(to.getTime() - 1));
  const [rows, items] = await Promise.all([
    MarketPrice.find({ itemId: { $in: itemIds }, weekOf: { $gte: fromWeek, $lte: toWeek } }).lean(),
    PriceItem.find({ _id: { $in: itemIds } })
      .select('nameAr unit')
      .lean(),
  ]);
  const unitOf = new Map(items.map((i) => [String(i._id), i]));
  const out = new Map<string, number>();
  for (const id of itemIds) {
    const own = rows.filter((r) => String(r.itemId) === id);
    if (!own.length) continue;
    const avg = own.reduce((a, r) => a + r.priceHalalas, 0) / own.length;
    // Market prices are per the item's unit; «متوسط سعر الطن» compares per ton.
    out.set(id, Math.round(unitOf.get(id)?.unit === 'kg' ? avg * 1000 : avg));
  }
  return { averages: out, names: new Map(items.map((i) => [String(i._id), i.nameAr])) };
}

export interface SalesKpiResult {
  period: string;
  scope: string;
  financeDataAvailable: boolean;
  kpis: KpiValue[];
  materials: {
    itemId: string | null;
    nameAr: string;
    kg: number;
    revenueHalalas: number;
    pricePerTonHalalas: number | null;
    marketPerTonHalalas: number | null;
  }[];
  board: Record<string, { value: number | null; link?: string; amountHalalas?: number | null }>;
}

/**
 * The five SAL §11 KPIs plus the §11.2 board for one month, filtered by employee and service [SAL §11.2 «الفلترة»].
 * Revenue = invoices issued in the month, before VAT (VAT is collected for ZATCA, not revenue — DECISIONS §20 S4).
 */
export async function salesKpis(
  req: AuthedRequest,
  q: SalesKpiQuery,
  now = new Date(),
): Promise<SalesKpiResult> {
  const eff = await permissionOn(req, 'sales.kpi', 'view');
  if (!eff) throw forbidden();
  const period = q.period ?? riyadhPeriod(now);
  const days = periodDays(period);
  const { from, to } = periodBounds(period);
  const ownOnly = eff.scope === 'own' || eff.scope === 'team';
  const userId = ownOnly ? String(req.auth.user._id) : q.userId;
  const [invEff, quoteEff, custEff, oppEff, settings, financeDataAvailable] = await Promise.all([
    permissionOn(req, 'finance.invoices', 'view'),
    permissionOn(req, 'sales.quotes', 'view'),
    permissionOn(req, 'crm.customers', 'view'),
    permissionOn(req, 'sales.opportunities', 'view'),
    getSetting('sales.kpiTargets'),
    anyInvoices(),
  ]);

  // Finance data (read-only).
  const facts =
    invEff && financeDataAvailable
      ? await invoiceFacts(req, invEff, {
          issuedFrom: days.from,
          issuedTo: days.to,
          ownerUserId: userId,
          serviceType: q.serviceType,
        })
      : null;
  const revenue = facts ? facts.reduce((a, f) => a + (f.subtotalHalalas ?? 0), 0) : null;
  const byMaterial = new Map<string, { itemId: string | null; nameAr: string; kg: number; amount: number }>();
  if (facts)
    for (const f of facts)
      for (const l of f.lines ?? []) {
        const kg = lineKg(l);
        if (!kg) continue;
        const k = l.itemId ? String(l.itemId) : `desc:${l.descriptionAr ?? ''}`;
        const m = byMaterial.get(k) ?? {
          itemId: l.itemId ? String(l.itemId) : null,
          nameAr: l.descriptionAr ?? '',
          kg: 0,
          amount: 0,
        };
        m.kg += kg;
        m.amount += l.lineTotalHalalas ?? 0;
        byMaterial.set(k, m);
      }
  const totalKg = facts ? [...byMaterial.values()].reduce((a, m) => a + m.kg, 0) : null;
  const tonAmount = [...byMaterial.values()].reduce((a, m) => a + m.amount, 0);
  const pricePerTon = totalKg ? Math.round((tonAmount * 1000) / totalKg) : null;
  const ids = [...byMaterial.values()].map((m) => m.itemId).filter((x): x is string => !!x);
  const market = ids.length ? await marketAverageForPeriod(ids, period) : null;
  const materials = [...byMaterial.values()].map((m) => ({
    itemId: m.itemId,
    nameAr: (m.itemId && market?.names.get(m.itemId)) || m.nameAr,
    kg: m.kg,
    revenueHalalas: m.amount,
    pricePerTonHalalas: m.kg ? Math.round((m.amount * 1000) / m.kg) : null,
    marketPerTonHalalas: m.itemId ? (market?.averages.get(m.itemId) ?? null) : null,
  }));
  // Market target for the average price: the market averages weighted by the kilograms sold of each material.
  const weighted = materials.filter((m) => m.marketPerTonHalalas !== null && m.kg > 0);
  const marketTarget = weighted.length
    ? Math.round(
        weighted.reduce((a, m) => a + (m.marketPerTonHalalas as number) * m.kg, 0) /
          weighted.reduce((a, m) => a + m.kg, 0),
      )
    : null;

  // Collection days: invoices fully collected in the month, from issue to the last payment.
  const collected =
    invEff && financeDataAvailable
      ? await collectedInvoiceFacts(req, invEff, from, to, {
          ownerUserId: userId,
          serviceType: q.serviceType,
        })
      : null;
  const avgCollectionDays =
    collected && collected.length
      ? Math.round(
          (collected.reduce((a, c) => a + (c.lastPaidAt.getTime() - new Date(c.issueDateTime).getTime()), 0) /
            collected.length /
            86_400_000) *
            10,
        ) / 10
      : null;

  // Quotes: one offer per chain (the newest version) sent in the month [SAL §11 «نسبة تحويل العروض»].
  const quoteQuery = { sentFrom: days.from, sentTo: days.to, ownerUserId: userId, latest: true };
  const quoteFilter = quoteEff ? quoteListFilter(req, quoteEff, quoteQuery) : null;
  const [sent, accepted, rejected] = quoteFilter
    ? await Promise.all([
        Quote.countDocuments(quoteFilter),
        Quote.countDocuments({ ...quoteFilter, state: 'accepted' }),
        Quote.countDocuments({ ...quoteFilter, state: 'rejected' }),
      ])
    : [0, 0, 0];
  const conversionBp = sent ? Math.round((accepted * 10_000) / sent) : null;

  const [revTarget, qtyTarget] = await Promise.all([
    revenueTarget(period, { userId, serviceType: q.serviceType }, 'revenue'),
    revenueTarget(period, { userId, serviceType: q.serviceType }, 'quantity'),
  ]);
  const def = (
    code: SalesKpiCode,
    unit: KpiValue['unit'],
    direction: 'higher' | 'lower',
    cumulative = false,
  ) => ({
    code,
    nameAr: SALES_KPI_AR[code],
    unit,
    direction,
    cumulative,
  });
  const kpis: KpiValue[] = [
    kpiValue(def('sales.revenue', 'halalas', 'higher', true), revenue, revTarget, period, now),
    kpiValue(def('sales.tons_sold', 'kg', 'higher', true), totalKg, qtyTarget, period, now),
    kpiValue(
      def('sales.quote_conversion', 'bp', 'higher'),
      conversionBp,
      settings.quoteConversionBp,
      period,
      now,
    ),
    kpiValue(
      def('sales.avg_price_per_ton', 'halalas_per_ton', 'higher'),
      pricePerTon,
      marketTarget,
      period,
      now,
    ),
    kpiValue(
      def('sales.avg_collection_days', 'days', 'lower'),
      avgCollectionDays,
      settings.collectionDays,
      period,
      now,
    ),
  ];

  // The §11.2 board: every number with the list it opens.
  const custFilter = custEff
    ? customerListFilter(req.auth.user, authzOf('crm.customers', 'view', custEff), {
        createdFrom: days.from,
        createdTo: days.to,
        ownerUserId: userId,
      })
    : null;
  const oppFilter = oppEff
    ? opportunityListFilter(req.auth.user, authzOf('sales.opportunities', 'view', oppEff), {
        createdFrom: days.from,
        createdTo: days.to,
        ownerUserId: userId,
        serviceType: q.serviceType,
      })
    : null;
  const unpaid =
    invEff && financeDataAvailable
      ? await invoiceFacts(req, invEff, { unpaid: true, ownerUserId: userId, serviceType: q.serviceType })
      : null;
  const remaining = revTarget !== null && revenue !== null ? Math.max(0, revTarget - revenue) : null;
  const owner = userId ? { ownerUserId: userId } : {};
  const svc = q.serviceType ? { serviceType: q.serviceType } : {};
  const board: SalesKpiResult['board'] = {
    monthlyTarget: { value: revTarget, link: listLink('/sales/targets', { period }) },
    achieved: {
      value: revenue,
      link: listLink('/sales/invoices', { issuedFrom: days.from, issuedTo: days.to, ...owner, ...svc }),
    },
    achievementBp: { value: revenue === null ? null : achievementBp(revenue, revTarget) },
    remaining: { value: remaining },
    newCustomers: {
      value: custFilter ? await countCustomers(custFilter) : null,
      link: listLink('/sales/customers', { createdFrom: days.from, createdTo: days.to, ...owner }),
    },
    opportunities: {
      value: oppFilter ? await Opportunity.countDocuments(oppFilter) : null,
      link: listLink('/sales/pipeline', {
        createdFrom: days.from,
        createdTo: days.to,
        view: 'table',
        ...owner,
        ...svc,
      }),
    },
    quotesSent: { value: sent, link: listLink('/sales/quotes', { ...quoteQuery, ownerUserId: userId }) },
    quotesAccepted: {
      value: accepted,
      link: listLink('/sales/quotes', { ...quoteQuery, state: 'accepted' }),
    },
    quotesRejected: {
      value: rejected,
      link: listLink('/sales/quotes', { ...quoteQuery, state: 'rejected' }),
    },
    revenue: {
      value: revenue,
      link: listLink('/sales/invoices', { issuedFrom: days.from, issuedTo: days.to, ...owner, ...svc }),
    },
    unpaidInvoices: {
      value: unpaid ? unpaid.length : null,
      amountHalalas: unpaid ? unpaid.reduce((a, u) => a + (u.remainingHalalas ?? 0), 0) : null,
      link: listLink('/sales/invoices', { unpaid: true, ...owner, ...svc }),
    },
    avgCollectionDays: { value: avgCollectionDays },
  };
  return {
    period,
    scope: eff.scope,
    financeDataAvailable: financeDataAvailable && !!invEff,
    kpis,
    materials,
    board,
  };
}

// ------------------------------------------------------------------------------------------------
// Dashboard [SAL §13] with read-only budget cards [SAL §8.3]
// ------------------------------------------------------------------------------------------------
export async function salesDashboard(req: AuthedRequest, q: { period?: string }, now = new Date()) {
  const eff = await permissionOn(req, 'sales.dashboard', 'view');
  if (!eff) throw forbidden();
  const period = q.period ?? riyadhPeriod(now);
  const days = periodDays(period);
  const { from, to } = periodBounds(period);
  const ownOnly = eff.scope === 'own' || eff.scope === 'team';
  const me = String(req.auth.user._id);
  const owner = ownOnly ? { ownerUserId: me } : {};
  const [custEff, oppEff, quoteEff, invEff, financeDataAvailable] = await Promise.all([
    permissionOn(req, 'crm.customers', 'view'),
    permissionOn(req, 'sales.opportunities', 'view'),
    permissionOn(req, 'sales.quotes', 'view'),
    permissionOn(req, 'finance.invoices', 'view'),
    anyInvoices(),
  ]);
  const kpi = await salesKpis(req, { period }, now);

  const card = async (
    count: () => Promise<number | null>,
    link: string,
    extra: Record<string, unknown> = {},
  ) => ({ value: await count(), link, ...extra });

  const cust = (extra: Record<string, unknown>) =>
    custEff
      ? countCustomers(
          customerListFilter(
            req.auth.user,
            authzOf('crm.customers', 'view', custEff),
            { ...owner, ...extra },
            now,
          ),
        )
      : Promise.resolve(null);
  const opp = (extra: Record<string, unknown>) =>
    oppEff
      ? Opportunity.countDocuments(
          opportunityListFilter(
            req.auth.user,
            authzOf('sales.opportunities', 'view', oppEff),
            { ...owner, ...extra },
            now,
          ),
        )
      : Promise.resolve(null);
  const quotes = (extra: Record<string, unknown>) =>
    quoteEff
      ? Quote.countDocuments(quoteListFilter(req, quoteEff, { ...owner, latest: true, ...extra }))
      : Promise.resolve(null);

  const openDeals = oppEff
    ? await Opportunity.find(
        opportunityListFilter(req.auth.user, authzOf('sales.opportunities', 'view', oppEff), {
          ...owner,
          open: true,
        }),
      )
        .select('expectedValueHalalas')
        .lean()
    : null;

  const salesGroup = {
    revenue: kpi.board.revenue,
    achieved: kpi.board.achieved,
    monthlyTarget: kpi.board.monthlyTarget,
    achievementBp: kpi.board.achievementBp,
    remaining: kpi.board.remaining,
    openDealsValue: {
      value: openDeals ? openDeals.reduce((a, o) => a + (o.expectedValueHalalas ?? 0), 0) : null,
      link: listLink('/sales/pipeline', { open: true, view: 'table', ...owner }),
    },
    won: await card(
      () => opp({ stage: 'won', closedFrom: days.from, closedTo: days.to }),
      `/sales/pipeline${qs({ stage: 'won', closedFrom: days.from, closedTo: days.to, view: 'table', ...owner })}`,
    ),
    lost: await card(
      () => opp({ stage: 'lost', closedFrom: days.from, closedTo: days.to }),
      `/sales/pipeline${qs({ stage: 'lost', closedFrom: days.from, closedTo: days.to, view: 'table', ...owner })}`,
    ),
  };
  const customersGroup = {
    total: await card(() => cust({}), `/sales/customers${qs(owner)}`),
    new: await card(
      () => cust({ createdFrom: days.from, createdTo: days.to }),
      `/sales/customers${qs({ createdFrom: days.from, createdTo: days.to, ...owner })}`,
    ),
    potential: await card(
      () => cust({ status: 'potential' }),
      `/sales/customers${qs({ status: 'potential', ...owner })}`,
    ),
    active: await card(
      () => cust({ status: 'active' }),
      `/sales/customers${qs({ status: 'active', ...owner })}`,
    ),
    followUpDue: await card(
      () => cust({ followUpDue: true }),
      `/sales/customers${qs({ followUpDue: true, ...owner })}`,
    ),
    referredFromCs: await card(
      () => cust({ referredFromCs: true }),
      `/sales/customers${qs({ referredFromCs: true, ...owner })}`,
    ),
  };
  const sentWindow = { sentFrom: days.from, sentTo: days.to };
  const opportunitiesGroup = {
    new: await card(
      () => opp({ stage: 'new' }),
      `/sales/pipeline${qs({ stage: 'new', view: 'table', ...owner })}`,
    ),
    inProgress: await card(
      () => opp({ stage: 'in_progress' }),
      `/sales/pipeline${qs({ stage: 'in_progress', view: 'table', ...owner })}`,
    ),
    quotesSent: await card(
      () => quotes(sentWindow),
      `/sales/quotes${qs({ ...sentWindow, latest: true, ...owner })}`,
    ),
    quotesAccepted: await card(
      () => quotes({ ...sentWindow, state: 'accepted' }),
      `/sales/quotes${qs({ ...sentWindow, latest: true, state: 'accepted', ...owner })}`,
    ),
    quotesRejected: await card(
      () => quotes({ ...sentWindow, state: 'rejected' }),
      `/sales/quotes${qs({ ...sentWindow, latest: true, state: 'rejected', ...owner })}`,
    ),
    followUpOverdue: await card(
      () => opp({ followUpDue: true }),
      `/sales/pipeline${qs({ followUpDue: true, view: 'table', ...owner })}`,
    ),
  };

  // Collection [SAL §13 خامساً] — Finance data, read-only.
  const inv = (query: Record<string, unknown>) =>
    invEff && financeDataAvailable
      ? invoiceFacts(req, invEff, { ...owner, ...query })
      : Promise.resolve(null);
  const [issued, unpaid, overdue] = await Promise.all([
    inv({ issuedFrom: days.from, issuedTo: days.to }),
    inv({ unpaid: true }),
    inv({ overdue: true }),
  ]);
  const sum = (
    rows: { totalHalalas?: number | null }[] | null,
    k: 'totalHalalas' | 'remainingHalalas' | 'collectedHalalas',
  ) => (rows ? rows.reduce((a, r) => a + ((r as Record<string, number | undefined>)[k] ?? 0), 0) : null);
  const issuedWindow = { issuedFrom: days.from, issuedTo: days.to };
  const collectionGroup = {
    invoices: {
      value: issued ? issued.length : null,
      amountHalalas: sum(issued, 'totalHalalas'),
      link: listLink('/sales/invoices', { ...issuedWindow, ...owner }),
    },
    paid: {
      value: issued ? issued.filter((i) => i.collectionState === 'collected').length : null,
      amountHalalas: sum(issued, 'collectedHalalas'),
      link: listLink('/sales/invoices', { ...issuedWindow, collectionState: 'collected', ...owner }),
    },
    unpaid: {
      value: unpaid ? unpaid.length : null,
      amountHalalas: sum(unpaid, 'remainingHalalas'),
      link: listLink('/sales/invoices', { unpaid: true, ...owner }),
    },
    overdue: {
      value: overdue ? overdue.length : null,
      amountHalalas: sum(overdue, 'remainingHalalas'),
      link: listLink('/sales/invoices', { overdue: true, ...owner }),
    },
    avgCollectionDays: kpi.board.avgCollectionDays,
  };

  // Employees [SAL §13 رابعاً]: the manager and the executive see every Sales member; a rep sees his own row.
  let members: { _id: unknown; displayNameAr?: string | null }[];
  if (ownOnly) members = [{ _id: req.auth.user._id, displayNameAr: req.auth.user.displayNameAr }];
  else {
    const salesDept = await salesDepartmentId();
    members = await User.find({ departmentId: salesDept, status: 'active', deletedAt: null })
      .select('displayNameAr')
      .sort({ displayNameAr: 1 })
      .lean();
  }
  const facts = invEff && financeDataAvailable ? await periodFacts(req, period) : null;
  const employees = await Promise.all(
    members.map(async (m) => {
      const uid = String(m._id);
      const target = await revenueTarget(period, { userId: uid });
      const achieved = facts ? achievedFrom(facts, { scope: 'user', userId: uid }) : null;
      const [openTasks, meetings] = await Promise.all([
        Task.countDocuments({ assigneeId: m._id, status: { $in: OPEN_TASK_STATUSES }, deletedAt: null }),
        CalendarEvent.countDocuments({
          deletedAt: null,
          type: { $in: ['meeting', 'visit'] },
          status: { $in: ['scheduled', 'rescheduled'] },
          startAt: { $gte: from, $lt: to },
          $or: [{ ownerId: m._id }, { participantIds: m._id }],
        }),
      ]);
      return {
        userId: uid,
        name: m.displayNameAr ?? '',
        target,
        achieved,
        achievementBp: achieved === null ? null : achievementBp(achieved, target),
        openTasks,
        scheduledMeetings: meetings,
        links: {
          customers: `/sales/customers${qs({ ownerUserId: uid })}`,
          invoices: `/sales/invoices${qs({ ...issuedWindow, ownerUserId: uid })}`,
          tasks: `/sales/tasks${qs({ assigneeId: uid })}`,
        },
      };
    }),
  );

  // Budget [SAL §8.3]: read-only from Finance; budgets don't exist until the Finance module (phase 4).
  const budget = {
    revenueHalalas: kpi.board.revenue.value,
    spentHalalas: null as number | null,
    remainingBudgetHalalas: null as number | null,
    budgetsAvailable: false,
  };
  return {
    period,
    scope: eff.scope,
    financeDataAvailable: financeDataAvailable && !!invEff,
    sales: salesGroup,
    customers: customersGroup,
    opportunities: opportunitiesGroup,
    employees,
    collection: collectionGroup,
    budget,
    kpis: kpi.kpis,
  };
}

// ------------------------------------------------------------------------------------------------
// Documents library [SAL §8.2]
// ------------------------------------------------------------------------------------------------
async function libraryScope(req: AuthedRequest, action: 'view' | 'create' | 'edit' | 'delete') {
  const eff = await permissionOn(req, 'sales.library', action);
  if (!eff) throw forbidden();
  if (eff.scope === 'all') return { eff, filter: {} as FilterQuery<unknown> };
  return {
    eff,
    filter: {
      departmentId: { $in: eff.departmentIds.map((d) => new Types.ObjectId(d)) },
    } as FilterQuery<unknown>,
  };
}

export async function canAccessLibraryDoc(req: AuthedRequest, id: string): Promise<boolean> {
  try {
    const { filter } = await libraryScope(req, 'view');
    return !!(await SalesLibraryDoc.exists({ _id: id, deletedAt: null, ...filter }));
  } catch {
    return false;
  }
}

export async function listLibrary(req: AuthedRequest) {
  const { filter } = await libraryScope(req, 'view');
  const rows = await SalesLibraryDoc.find({ deletedAt: null, replacedById: null, ...filter })
    .sort({ category: 1, title: 1 })
    .lean();
  const canManage = !!(await permissionOn(req, 'sales.library', 'create'));
  // The version number counts the chain (each upload of a new version adds one), whatever the title became.
  return { items: rows.map((r) => ({ ...r, versions: r.version ?? 1 })), canManage };
}

export async function libraryHistory(req: AuthedRequest, id: string) {
  const { filter } = await libraryScope(req, 'view');
  const start = await SalesLibraryDoc.findOne({ _id: id, deletedAt: null, ...filter }).lean();
  if (!start) throw notFound();
  const chain = [start];
  let prev = start.previousId;
  while (prev && chain.length < 50) {
    const p = await SalesLibraryDoc.findById(prev).lean();
    if (!p) break;
    chain.push(p);
    prev = p.previousId;
  }
  return { items: chain };
}

export async function createLibraryDoc(req: AuthedRequest, input: CreateLibraryDocInput) {
  const { eff } = await libraryScope(req, 'create');
  const salesDept = await salesDepartmentId();
  if (eff.scope !== 'all' && !eff.departmentIds.includes(salesDept)) throw forbidden();
  const att = await Attachment.findById(input.attachmentId).select('mimeType uploadedBy').lean();
  if (!att) throw badRequest('الملف غير موجود');
  if (att.mimeType !== 'application/pdf')
    throw badRequest('الإجراءات والتعليمات تُرفع بصيغة PDF', [{ path: 'attachmentId', message: 'PDF فقط' }]);
  let previous: { _id: unknown; version?: number | null } | null = null;
  if (input.replacesId) {
    previous = await SalesLibraryDoc.findOne({
      _id: input.replacesId,
      deletedAt: null,
      replacedById: null,
      departmentId: salesDept,
    })
      .select('version')
      .lean();
    if (!previous) throw conflict('المستند المراد استبداله غير موجود أو له نسخة أحدث');
  }
  const actor = actorFrom(req);
  return withTransaction(async (session) => {
    const [doc] = await SalesLibraryDoc.create(
      [
        {
          title: input.title,
          category: input.category,
          description: input.description,
          attachmentId: input.attachmentId,
          departmentId: salesDept,
          version: (previous?.version ?? 0) + 1,
          previousId: previous?._id,
          uploadedByUserId: req.auth.user._id,
          uploadedByName: req.auth.user.displayNameAr,
        },
      ],
      { session, ordered: true },
    );
    await claimAttachments(
      [input.attachmentId],
      'sales_library',
      String(doc._id),
      req.auth.user._id,
      session,
    );
    if (previous) {
      const r = await SalesLibraryDoc.updateOne(
        { _id: previous._id, replacedById: null },
        { $set: { replacedById: doc._id } },
        { session },
      );
      if (!r.modifiedCount) throw conflict('رُفعت نسخة أحدث في الوقت نفسه، حدّث الصفحة');
    }
    await recordAudit(
      actor,
      {
        action: 'create',
        resource: 'sales.library',
        resourceId: String(doc._id),
        after: { title: input.title, category: input.category, version: doc.version },
      },
      session,
    );
    return doc.toObject();
  });
}

export async function deleteLibraryDoc(req: AuthedRequest, id: string) {
  const { filter } = await libraryScope(req, 'delete');
  const doc = await SalesLibraryDoc.findOneAndUpdate(
    { _id: id, deletedAt: null, replacedById: null, ...filter },
    { $set: { deletedAt: new Date() } },
    { new: true },
  ).lean();
  if (!doc) throw notFound();
  await recordAudit(actorFrom(req), {
    action: 'delete',
    resource: 'sales.library',
    resourceId: id,
    before: { title: doc.title, version: doc.version },
  });
}

export { invoiceListFilter };
export { OPEN_OPPORTUNITY_STAGES };
