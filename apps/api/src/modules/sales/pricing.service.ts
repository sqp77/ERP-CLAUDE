import { normalizeArabic, type PriceUnit } from '@eayni/shared';
import { badRequest, conflict, forbidden, notFound } from '../../core/http/errors';
import { actorFrom, type AuthedRequest } from '../../core/http/context';
import { recordAudit } from '../../core/audit/service';
import { getSetting } from '../../core/settings/service';
import { startOfRiyadhWeek } from '../../core/dates/businessDays';
import { riyadhDate } from '../../core/dates/businessDays';
import { MarketPrice, PriceEntry, PriceItem } from './pricing.model';

/** Who may edit prices and market prices: the roles in `sales.priceEditorRoles` (Q6 default: the Sales manager) [SAL §7.1]. */
export async function assertPriceEditor(req: AuthedRequest): Promise<void> {
  const roles = await getSetting('sales.priceEditorRoles');
  if (!req.auth.roleCodes.some((r) => roles.includes(r)))
    throw forbidden('تعديل الأسعار من صلاحيات الموظفين المخولين (إعداد sales.priceEditorRoles)');
}

export interface EffectivePrice {
  itemId: string;
  nameAr: string;
  unit: PriceUnit;
  kind: string;
  priceHalalas: number | null;
  validFrom: Date | null;
  marketPriceHalalas: number | null;
  marketWeekOf: string | null;
}

/** Effective price = the latest entry whose valid-from has arrived; market price = the latest weekly row. */
export async function effectivePrices(
  itemIds?: string[],
  at = new Date(),
): Promise<Map<string, EffectivePrice>> {
  const items = await PriceItem.find({
    deletedAt: null,
    ...(itemIds ? { _id: { $in: itemIds } } : {}),
  }).lean();
  const ids = items.map((i) => i._id);
  const [entries, market] = await Promise.all([
    PriceEntry.find({ itemId: { $in: ids }, validFrom: { $lte: at } })
      .sort({ validFrom: -1, at: -1 })
      .lean(),
    MarketPrice.find({ itemId: { $in: ids } })
      .sort({ weekOf: -1, at: -1 })
      .lean(),
  ]);
  const out = new Map<string, EffectivePrice>();
  for (const i of items) {
    const e = entries.find((x) => String(x.itemId) === String(i._id));
    const m = market.find((x) => String(x.itemId) === String(i._id));
    out.set(String(i._id), {
      itemId: String(i._id),
      nameAr: i.nameAr,
      unit: i.unit as PriceUnit,
      kind: i.kind,
      priceHalalas: e?.priceHalalas ?? null,
      validFrom: e?.validFrom ?? null,
      marketPriceHalalas: m?.priceHalalas ?? null,
      marketWeekOf: m?.weekOf ?? null,
    });
  }
  return out;
}

export async function listPriceList(includeInactive = false) {
  const items = await PriceItem.find({ deletedAt: null, ...(includeInactive ? {} : { active: true }) })
    .sort({ kind: 1, category: 1, nameAr: 1 })
    .lean();
  const eff = await effectivePrices(items.map((i) => String(i._id)));
  return items.map((i) => ({ ...i, ...eff.get(String(i._id)) }));
}

export async function createPriceItem(
  req: AuthedRequest,
  input: {
    kind: 'material' | 'service';
    nameAr: string;
    category?: string;
    unit: PriceUnit;
    priceHalalas?: number;
    validFrom?: string;
    notes?: string;
  },
) {
  await assertPriceEditor(req);
  const normalizedName = normalizeArabic(input.nameAr);
  if (await PriceItem.exists({ kind: input.kind, normalizedName, deletedAt: null }))
    throw conflict('المادة أو الخدمة موجودة مسبقًا في القائمة');
  const actor = actorFrom(req);
  const item = await PriceItem.create({
    kind: input.kind,
    nameAr: input.nameAr,
    normalizedName,
    category: input.category,
    unit: input.unit,
    notes: input.notes,
    createdByUserId: req.auth.user._id,
  });
  if (input.priceHalalas !== undefined)
    await PriceEntry.create({
      itemId: item._id,
      priceHalalas: input.priceHalalas,
      validFrom: input.validFrom ? new Date(input.validFrom) : new Date(),
      byUserId: req.auth.user._id,
      byEmail: req.auth.user.email,
      note: 'السعر الأول',
    });
  await recordAudit(actor, {
    action: 'create',
    resource: 'sales.pricelist',
    resourceId: String(item._id),
    after: { ...input },
  });
  return (await listPriceList(true)).find((x) => String(x._id) === String(item._id));
}

export async function updatePriceItem(req: AuthedRequest, id: string, input: Record<string, unknown>) {
  await assertPriceEditor(req);
  const before = await PriceItem.findOne({ _id: id, deletedAt: null }).lean();
  if (!before) throw notFound();
  const set: Record<string, unknown> = {};
  if (typeof input.nameAr === 'string')
    Object.assign(set, { nameAr: input.nameAr, normalizedName: normalizeArabic(input.nameAr) });
  for (const k of ['category', 'active', 'notes']) if (input[k] !== undefined) set[k] = input[k];
  await PriceItem.updateOne({ _id: id }, { $set: set });
  await recordAudit(actorFrom(req), {
    action: 'update',
    resource: 'sales.pricelist',
    resourceId: id,
    before,
    after: set,
  });
  return (await listPriceList(true)).find((x) => String(x._id) === id);
}

/** New price = new append-only entry (golden rule 3); a future valid-from schedules the change [SAL §7.1 «تحديد تاريخ سريان السعر»]. */
export async function addPriceEntry(
  req: AuthedRequest,
  itemId: string,
  input: { priceHalalas: number; validFrom?: string; note?: string },
) {
  await assertPriceEditor(req);
  if (!(await PriceItem.exists({ _id: itemId, deletedAt: null }))) throw notFound();
  const e = await PriceEntry.create({
    itemId,
    priceHalalas: input.priceHalalas,
    validFrom: input.validFrom ? new Date(input.validFrom) : new Date(),
    byUserId: req.auth.user._id,
    byEmail: req.auth.user.email,
    note: input.note,
  });
  await recordAudit(actorFrom(req), {
    action: 'create',
    resource: 'sales.pricelist.entries',
    resourceId: String(e._id),
    after: { itemId, ...input },
  });
  return e;
}

/** Weekly market price, keyed by the Riyadh week (Sunday) [SAL §7.1 «تحديث الأسعار وفق أسعار السوق الأسبوعية»]. */
export async function addMarketPrice(
  req: AuthedRequest,
  itemId: string,
  input: { priceHalalas: number; weekOf?: string; source?: string },
) {
  await assertPriceEditor(req);
  if (!(await PriceItem.exists({ _id: itemId, deletedAt: null }))) throw notFound();
  const weekOf = input.weekOf ?? riyadhDate(startOfRiyadhWeek(new Date()));
  const m = await MarketPrice.create({
    itemId,
    weekOf,
    priceHalalas: input.priceHalalas,
    source: input.source,
    byUserId: req.auth.user._id,
    byEmail: req.auth.user.email,
  });
  await recordAudit(actorFrom(req), {
    action: 'create',
    resource: 'sales.pricelist.market',
    resourceId: String(m._id),
    after: { itemId, ...input, weekOf },
  });
  return m;
}

export async function priceHistory(itemId: string) {
  const [entries, market] = await Promise.all([
    PriceEntry.find({ itemId }).sort({ validFrom: -1, at: -1 }).lean(),
    MarketPrice.find({ itemId }).sort({ weekOf: -1, at: -1 }).limit(52).lean(),
  ]);
  return { entries, market };
}

/** Market average over a period, used by «متوسط سعر الطن» (S4) and the quote hint. */
export async function marketAverage(
  itemId: string,
  fromWeek: string,
  toWeek: string,
): Promise<number | null> {
  const rows = await MarketPrice.find({ itemId, weekOf: { $gte: fromWeek, $lte: toWeek } }).lean();
  if (!rows.length) return null;
  return Math.round(rows.reduce((s, r) => s + r.priceHalalas, 0) / rows.length);
}

export function assertMoney(n: unknown): number {
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) throw badRequest('مبلغ غير صالح');
  return n;
}
