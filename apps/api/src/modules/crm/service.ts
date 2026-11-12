import { Types, type ClientSession, type FilterQuery } from 'mongoose';
import { randomUUID } from 'node:crypto';
import {
  MAX_CONTACTS_PER_CUSTOMER,
  OPEN_LEAD_STATES,
  arabicSearchRegex,
  normalizeArabic,
  type ContactInput,
  type CreateCommunicationLogInput,
  type CreateCustomerInput,
  type CreateLeadInput,
  type RoleAssignment,
  type TransferCustomersInput,
  type UpdateCustomerInput,
} from '@eayni/shared';
import { badRequest, conflict, forbidden, notFound } from '../../core/http/errors';
import { actorFrom, type Actor, type Authz, type AuthedRequest } from '../../core/http/context';
import { recordAudit } from '../../core/audit/service';
import { nextNumber } from '../../core/numbering/service';
import { notify } from '../../core/notifications/service';
import { publish } from '../../core/outbox/service';
import { getSetting } from '../../core/settings/service';
import { effectivePermission } from '../../core/rbac/service';
import { claimAttachments } from '../../core/files/service';
import { canonicalTags } from '../../core/tags/service';
import { ensureCustomerParty, findPartyByNumbers } from '../../core/parties/service';
import { Party } from '../../core/parties/model';
import { Department } from '../../core/org/model';
import { User, type UserDoc } from '../../core/auth/model';
import { departmentManagerUserIds } from '../../core/tasks/jobs';
import { lookupAssignee } from '../../core/tasks/service';
import { roleCodesOf } from '../../core/rbac/service';
import { withTransaction } from '../../db';
import {
  CommunicationLog,
  Contact,
  Customer,
  CustomerEvent,
  Lead,
  LeadEvent,
  type CustomerDoc,
  type LeadDoc,
} from './model';

export const DUPLICATE_MESSAGE = 'هذه الجهة مسجلة لدى موظف آخر — راجع مدير القسم';
export const TAG_SCOPE = 'sales';

// ------------------------------------------------------------------------------------------------
// Departments, people, names
// ------------------------------------------------------------------------------------------------
const deptCache = new Map<string, { id: string | null; at: number }>();
/** Test hook: the suite wipes the database between tests, so cached department ids must go too. */
export function clearCrmCache(): void {
  deptCache.clear();
}
export async function departmentIdByCode(code: string): Promise<string | null> {
  const hit = deptCache.get(code);
  if (hit && Date.now() - hit.at < 10_000) return hit.id;
  const d = await Department.findOne({ code, deletedAt: null }).select('_id').lean();
  const id = d ? String(d._id) : null;
  deptCache.set(code, { id, at: Date.now() });
  return id;
}
export async function salesDepartmentId(): Promise<string> {
  const id = await departmentIdByCode('sales');
  if (!id) throw badRequest('قسم المبيعات غير معرّف في الهيكل التنظيمي');
  return id;
}

/** Sales managers to notify: department managers of Sales plus explicit `sales_manager` holders [SAL §8.1, §14]. */
export async function salesManagerUserIds(departmentId?: string): Promise<string[]> {
  const deptId = departmentId ?? (await salesDepartmentId());
  const explicit = await User.find({
    status: 'active',
    deletedAt: null,
    $or: [
      { roles: { $elemMatch: { role: 'sales_manager', departmentId: deptId } } },
      { departmentId: deptId, roles: { $elemMatch: { role: 'sales_manager', departmentId: null } } },
    ],
  })
    .select('_id')
    .lean();
  return [...new Set([...(await departmentManagerUserIds(deptId)), ...explicit.map((u) => String(u._id))])];
}

export async function userNames(ids: readonly unknown[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  if (!unique.length) return new Map();
  const users = await User.find({ _id: { $in: unique } })
    .select('displayNameAr')
    .lean();
  return new Map(users.map((u) => [String(u._id), u.displayNameAr]));
}

/** Digits only, Saudi numbers normalised to the local form (+966 5x → 05x) so one phone matches whatever way it was typed. */
export const NOT_SALES_STAFF = 'الموظف المستلم ليس من موظفي المبيعات';

/**
 * Who may receive a customer, lead or opportunity (S1 approval fix 1): an active, on-duty member of a department in
 * the actor's scope (the Sales department for 'all' scope) who holds Sales rights (sales_rep / sales_manager, implied
 * included). Anything else is 400 — a file never lands outside Sales, and no outsider learns a customer's name.
 */
export async function assertSalesTarget(authz: Authz, userId: string): Promise<UserDoc> {
  const u = await User.findOne({ _id: userId, status: 'active', deletedAt: null });
  if (!u || !u.departmentId) throw badRequest(NOT_SALES_STAFF, { code: 'not_sales_staff' });
  const deptId = String(u.departmentId);
  const allowed = authz.scope === 'all' ? [await salesDepartmentId()] : authz.departmentIds;
  if (!allowed.includes(deptId)) throw badRequest(NOT_SALES_STAFF, { code: 'not_sales_staff' });
  const emp = await lookupAssignee(userId);
  if (emp && (!emp.active || (emp.departmentId && emp.departmentId !== deptId)))
    throw badRequest(NOT_SALES_STAFF, { code: 'not_sales_staff' });
  const codes = await roleCodesOf(u.roles as RoleAssignment[], deptId);
  if (!codes.includes('sales_rep') && !codes.includes('sales_manager'))
    throw badRequest(NOT_SALES_STAFF, { code: 'not_sales_staff' });
  return u;
}

const digits = (s?: string | null) => {
  if (!s) return undefined;
  let d = s.replace(/\D/g, '');
  if (d.startsWith('00966')) d = d.slice(5);
  else if (d.startsWith('966') && d.length >= 12) d = d.slice(3);
  if (d.length === 9 && d.startsWith('5')) d = `0${d}`;
  return d || undefined;
};

/** Number and name of customers, for other modules' lists (golden rule 2: reference, never copy). */
export async function customerLabels(
  ids: readonly unknown[],
): Promise<Map<string, { number: string; nameAr: string }>> {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  if (!unique.length) return new Map();
  const rows = await Customer.find({ _id: { $in: unique } })
    .select('number nameAr')
    .lean();
  return new Map(rows.map((c) => [String(c._id), { number: c.number, nameAr: c.nameAr }]));
}
export async function customerPartyId(customerId: string): Promise<string | null> {
  const c = await Customer.findById(customerId).select('partyId').lean();
  return c?.partyId ? String(c.partyId) : null;
}
export const countCustomers = (filter: FilterQuery<unknown>) =>
  Customer.countDocuments({ deletedAt: null, ...filter });
export const countLeads = (filter: FilterQuery<unknown>) =>
  Lead.countDocuments({ deletedAt: null, ...filter });

// ------------------------------------------------------------------------------------------------
// Scope and access
// ------------------------------------------------------------------------------------------------
/** Rep → own records; Sales manager → department (plus own); executive / admin → all [SAL §15]. */
export function customerScopeFilter(user: UserDoc, authz: Authz): FilterQuery<unknown> {
  if (authz.scope === 'all') return {};
  if (authz.scope === 'department')
    return {
      $or: [
        { departmentId: { $in: authz.departmentIds.map((d) => new Types.ObjectId(d)) } },
        { ownerUserId: user._id },
      ],
    };
  return { ownerUserId: user._id };
}

export async function permissionOn(
  req: AuthedRequest,
  resource: string,
  action: 'view' | 'edit' | 'create' | 'approve',
) {
  return effectivePermission(
    req.auth.user.roles as RoleAssignment[],
    req.auth.user.departmentId ? String(req.auth.user.departmentId) : undefined,
    resource,
    action,
    String(req.auth.user._id),
  );
}

export async function canAccessCustomer(req: AuthedRequest, customerId: string): Promise<boolean> {
  const eff = await permissionOn(req, 'crm.customers', 'view');
  if (!eff) return false;
  const filter = customerScopeFilter(req.auth.user, { resource: 'crm.customers', action: 'view', ...eff });
  return !!(await Customer.exists({ _id: customerId, deletedAt: null, ...filter }));
}

async function loadCustomerFor(req: AuthedRequest, id: string, action: 'view' | 'edit' = 'view') {
  const eff = await permissionOn(req, 'crm.customers', action);
  if (!eff) throw forbidden();
  const filter = customerScopeFilter(req.auth.user, { resource: 'crm.customers', action, ...eff });
  const c = await Customer.findOne({ _id: id, deletedAt: null, ...filter });
  if (!c) {
    // Hidden records look like missing ones; a rep learns nothing about another rep's file (SAL §15).
    throw notFound();
  }
  return { customer: c, eff };
}

const isManagerScope = (scope: string) => scope === 'department' || scope === 'all';

// ------------------------------------------------------------------------------------------------
// Duplicates [SAL §19 «ملف موحد»]
// ------------------------------------------------------------------------------------------------
export interface DuplicateCheck {
  nameAr?: string;
  phone?: string;
  crNumber?: string;
  unifiedNumber?: string;
  vatNumber?: string;
  excludeId?: string;
}
async function findDuplicates(input: DuplicateCheck) {
  const or: Record<string, unknown>[] = [];
  const hard: Record<string, unknown>[] = [];
  if (input.nameAr) or.push({ normalizedName: normalizeArabic(input.nameAr) });
  const d = digits(input.phone);
  if (d && d.length >= 9) or.push({ phoneDigits: d });
  const party = await findPartyByNumbers({ legalNameAr: input.nameAr ?? '', ...input });
  if (party) hard.push({ partyId: party._id });
  const base: Record<string, unknown> = { deletedAt: null };
  if (input.excludeId) base._id = { $ne: input.excludeId };
  const all = or.length || hard.length ? await Customer.find({ ...base, $or: [...or, ...hard] }).lean() : [];
  const hardIds = hard.length
    ? new Set(
        (
          await Customer.find({ ...base, $or: hard })
            .select('_id')
            .lean()
        ).map((c) => String(c._id)),
      )
    : new Set<string>();
  return { all, hardIds };
}

/**
 * «هل الجهة مسجلة؟» before saving: matches on normalized name, phone and official numbers. A match the caller may
 * see is returned with its number and owner; a match outside the caller's scope is reported only as a message.
 */
export async function checkDuplicate(req: AuthedRequest, input: DuplicateCheck) {
  const eff = await permissionOn(req, 'crm.customers', 'view');
  if (!eff) throw forbidden();
  const { all, hardIds } = await findDuplicates(input);
  if (!all.length) return { duplicate: false as const, hard: false, visible: [], hiddenCount: 0 };
  const filter = customerScopeFilter(req.auth.user, { resource: 'crm.customers', action: 'view', ...eff });
  const visibleIds = new Set(
    (
      await Customer.find({ _id: { $in: all.map((c) => c._id) }, ...filter })
        .select('_id')
        .lean()
    ).map((c) => String(c._id)),
  );
  const names = await userNames(all.map((c) => c.ownerUserId));
  const visible = all
    .filter((c) => visibleIds.has(String(c._id)))
    .map((c) => ({
      id: String(c._id),
      number: c.number,
      nameAr: c.nameAr,
      ownerUserId: String(c.ownerUserId),
      ownerName: names.get(String(c.ownerUserId)) ?? '',
      hard: hardIds.has(String(c._id)),
    }));
  return {
    duplicate: true as const,
    hard: hardIds.size > 0,
    visible,
    hiddenCount: all.length - visible.length,
    message: all.length - visible.length > 0 ? DUPLICATE_MESSAGE : undefined,
  };
}

// ------------------------------------------------------------------------------------------------
// Hooks for other modules (no cross-module model imports)
// ------------------------------------------------------------------------------------------------
export type CustomerCreatedHook = (args: {
  customer: CustomerDoc & { _id: unknown };
  input: CreateCustomerInput;
  req: AuthedRequest;
  session: ClientSession | undefined;
}) => Promise<void>;
const createdHooks: CustomerCreatedHook[] = [];
export function registerCustomerCreatedHook(fn: CustomerCreatedHook): void {
  createdHooks.push(fn);
}
export type OwnerChangeHook = (args: {
  customerIds: string[];
  fromByCustomer: Map<string, string>;
  toUserId: string;
  actor: Actor;
  reason: string;
  batchId: string;
  session: ClientSession | undefined;
}) => Promise<void>;
const ownerChangeHooks: OwnerChangeHook[] = [];
export function registerOwnerChangeHook(fn: OwnerChangeHook): void {
  ownerChangeHooks.push(fn);
}
/** When a lead is converted onto an EXISTING customer, Sales may still open the first opportunity. */
export type LeadConvertedHook = (args: {
  lead: LeadDoc & { _id: unknown };
  customerId: string;
  input: { createOpportunity: boolean; opportunityTitle?: string; expectedValueHalalas?: number };
  req: AuthedRequest;
  session: ClientSession | undefined;
}) => Promise<void>;
const leadConvertedHooks: LeadConvertedHook[] = [];
export function registerLeadConvertedHook(fn: LeadConvertedHook): void {
  leadConvertedHooks.push(fn);
}

// ------------------------------------------------------------------------------------------------
// Customers
// ------------------------------------------------------------------------------------------------
async function resolveOwner(
  req: AuthedRequest,
  requested: string | undefined,
  scope: string,
): Promise<UserDoc> {
  if (!requested || requested === String(req.auth.user._id)) return req.auth.user;
  if (!isManagerScope(scope)) throw forbidden('تعيين الموظف المسؤول من صلاحيات مدير القسم');
  return assertSalesTarget(req.authz!, requested);
}

async function ownerDepartmentId(owner: UserDoc): Promise<string> {
  // The file belongs to the owner's department (Sales now; Sustainability later), falling back to Sales.
  if (owner.departmentId) {
    const code = (await Department.findById(owner.departmentId).select('code').lean())?.code;
    if (code === 'sales' || code === 'sustainability') return String(owner.departmentId);
  }
  return salesDepartmentId();
}

/** «عميل جديد / فرصة بيعية جديدة» [SAL §4.1]: customer + up to 3 contacts (+ the first opportunity through the Sales hook). */
export async function createCustomer(req: AuthedRequest, input: CreateCustomerInput) {
  const authz = req.authz!;
  const owner = await resolveOwner(req, input.ownerUserId, authz.scope);
  const dup = await findDuplicates(input);
  if (dup.hardIds.size)
    throw conflict('الجهة مسجلة مسبقًا بالرقم الرسمي نفسه', { code: 'duplicate_customer' });
  if (dup.all.length) {
    const allowed = isManagerScope(authz.scope) && input.confirmDuplicateName;
    if (!allowed) {
      // A rep never learns who owns the other file.
      const eff = await permissionOn(req, 'crm.customers', 'view');
      const filter = customerScopeFilter(req.auth.user, {
        resource: 'crm.customers',
        action: 'view',
        ...eff!,
      });
      const visible = await Customer.findOne({ _id: { $in: dup.all.map((c) => c._id) }, ...filter })
        .select('number')
        .lean();
      throw conflict(visible ? `الجهة مسجلة مسبقًا (${visible.number})` : DUPLICATE_MESSAGE, {
        code: 'duplicate_customer',
        number: visible?.number,
      });
    }
  }
  const tags = await canonicalTags(TAG_SCOPE, input.tags);
  const lead = input.leadId ? await Lead.findOne({ _id: input.leadId, deletedAt: null }) : null;
  if (input.leadId && !lead) throw badRequest('العميل المحتمل غير موجود');
  const departmentId = await ownerDepartmentId(owner);
  const actor = actorFrom(req);
  const customer = await withTransaction(async (session) => {
    const party =
      input.kind === 'organization' && (input.crNumber || input.unifiedNumber || input.vatNumber)
        ? await ensureCustomerParty(
            {
              legalNameAr: input.nameAr,
              crNumber: input.crNumber,
              unifiedNumber: input.unifiedNumber,
              vatNumber: input.vatNumber,
              nationalAddress: input.nationalAddress,
              email: input.email,
              phone: input.phone,
            },
            session,
          )
        : null;
    const [doc] = await Customer.create(
      [
        {
          number: await nextNumber('customer', session),
          kind: input.kind,
          partyId: party?._id,
          nameAr: input.nameAr,
          normalizedName: normalizeArabic(input.nameAr),
          country: input.country,
          region: input.region,
          city: input.city,
          activity: input.activity,
          organizationType: input.organizationType,
          facilitySize: input.facilitySize,
          source: lead ? 'customer_service' : input.source,
          sourceNote: input.sourceNote,
          status: input.status,
          phone: input.phone,
          phoneDigits: digits(input.phone),
          email: input.email,
          notes: input.notes,
          tags,
          ownerUserId: owner._id,
          departmentId,
          createdByUserId: req.auth.user._id,
          leadId: lead?._id,
        },
      ],
      { session, ordered: true },
    );
    if (input.contacts.length)
      await Contact.create(
        input.contacts.map((c) => ({ ...c, customerId: doc._id })),
        { session, ordered: true },
      );
    await CustomerEvent.create(
      [
        {
          customerId: doc._id,
          type: 'created',
          toUserId: owner._id,
          byUserId: actor.userId,
          byEmail: actor.email,
        },
        ...(lead
          ? [
              {
                customerId: doc._id,
                type: 'lead_linked',
                to: lead.number,
                byUserId: actor.userId,
                byEmail: actor.email,
              },
            ]
          : []),
      ],
      { session, ordered: true },
    );
    if (lead) {
      const from = lead.state;
      lead.state = 'converted';
      lead.customerId = doc._id;
      lead.registeredAt ??= new Date();
      await lead.save({ session });
      await LeadEvent.create(
        [
          {
            leadId: lead._id,
            type: 'converted',
            from,
            to: 'converted',
            byUserId: actor.userId,
            byEmail: actor.email,
            note: doc.number,
          },
        ],
        { session, ordered: true },
      );
    }
    for (const hook of createdHooks) await hook({ customer: doc, input, req, session });
    await recordAudit(
      actor,
      {
        action: 'create',
        resource: 'crm.customers',
        resourceId: String(doc._id),
        after: { number: doc.number, nameAr: doc.nameAr, ownerUserId: String(owner._id) },
      },
      session,
    );
    await publish(
      {
        type: 'crm.customer.created',
        aggregateType: 'customer',
        aggregateId: String(doc._id),
        payload: {
          number: doc.number,
          ownerUserId: String(owner._id),
          leadId: lead ? String(lead._id) : undefined,
        },
        actorUserId: actor.userId,
      },
      session,
    );
    return doc;
  });
  if (String(owner._id) !== String(req.auth.user._id))
    await notify({
      userIds: [String(owner._id)],
      type: 'crm.customer.assigned',
      bodyAr: `${customer.number} — ${customer.nameAr}`,
      link: `/sales/customers/${customer._id}`,
      data: { customerId: String(customer._id) },
    });
  return customer;
}

export interface ListCustomersQuery {
  page: number;
  limit: number;
  q?: string;
  status?: string;
  source?: string;
  classification?: string;
  ownerUserId?: string;
  tag?: string;
  followUpDue?: boolean;
  referredFromCs?: boolean;
  sort: 'recent' | 'name' | 'followUp' | 'lastContact';
}
export async function listCustomers(req: AuthedRequest, q: ListCustomersQuery) {
  const filter: FilterQuery<unknown> = { deletedAt: null, ...customerScopeFilter(req.auth.user, req.authz!) };
  if (q.status) filter.status = q.status;
  if (q.source) filter.source = q.source;
  if (q.classification) filter.classification = q.classification;
  if (q.ownerUserId) filter.ownerUserId = q.ownerUserId;
  if (q.tag) filter.tags = q.tag;
  if (q.followUpDue) filter.nextFollowUpAt = { $lt: new Date() };
  if (q.referredFromCs) filter.leadId = { $ne: null };
  if (q.q) {
    const d = digits(q.q);
    filter.$and = [
      {
        $or: [
          { nameAr: arabicSearchRegex(q.q) },
          { number: q.q.toUpperCase() },
          { city: arabicSearchRegex(q.q) },
          { activity: arabicSearchRegex(q.q) },
          ...(d && d.length >= 4 ? [{ phoneDigits: new RegExp(d) }] : []),
        ],
      },
    ];
  }
  const sort: Record<string, 1 | -1> =
    q.sort === 'name'
      ? { nameAr: 1 }
      : q.sort === 'followUp'
        ? { nextFollowUpAt: 1 }
        : q.sort === 'lastContact'
          ? { lastContactAt: -1 }
          : { createdAt: -1 };
  const [rows, total] = await Promise.all([
    Customer.find(filter)
      .sort(sort)
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .lean(),
    Customer.countDocuments(filter),
  ]);
  const names = await userNames(rows.map((r) => r.ownerUserId));
  return {
    items: rows.map((r) => ({ ...r, ownerName: names.get(String(r.ownerUserId)) ?? '' })),
    total,
    page: q.page,
    limit: q.limit,
  };
}

export async function getCustomer(req: AuthedRequest, id: string) {
  const { customer, eff } = await loadCustomerFor(req, id);
  const [contacts, party, events, names] = await Promise.all([
    Contact.find({ customerId: customer._id, deletedAt: null }).sort({ createdAt: 1 }).lean(),
    customer.partyId ? Party.findById(customer.partyId).lean() : null,
    CustomerEvent.find({ customerId: customer._id }).sort({ at: 1 }).lean(),
    userNames([customer.ownerUserId, customer.createdByUserId]),
  ]);
  const eventNames = await userNames(events.flatMap((e) => [e.fromUserId, e.toUserId, e.byUserId]));
  return {
    ...customer.toObject(),
    ownerName: names.get(String(customer.ownerUserId)) ?? '',
    createdByName: customer.createdByUserId ? names.get(String(customer.createdByUserId)) : undefined,
    party: party
      ? {
          id: String(party._id),
          legalNameAr: party.legalNameAr,
          crNumber: party.crNumber,
          unifiedNumber: party.unifiedNumber,
          vatNumber: party.vatNumber,
          nationalAddress: party.nationalAddress,
        }
      : null,
    contacts,
    events: events.map((e) => ({
      ...e,
      fromUserName: e.fromUserId ? eventNames.get(String(e.fromUserId)) : undefined,
      toUserName: e.toUserId ? eventNames.get(String(e.toUserId)) : undefined,
      byUserName: e.byUserId ? eventNames.get(String(e.byUserId)) : undefined,
    })),
    canManage: isManagerScope(eff.scope),
  };
}

export async function updateCustomer(req: AuthedRequest, id: string, input: UpdateCustomerInput) {
  const { customer, eff } = await loadCustomerFor(req, id, 'edit');
  const actor = actorFrom(req);
  const before = customer.toObject();
  if (input.classification !== undefined && !isManagerScope(eff.scope))
    throw forbidden('تصنيف العميل من صلاحيات مدير القسم');
  if (input.nameAr !== undefined || input.phone !== undefined) {
    const dup = await findDuplicates({
      nameAr: input.nameAr ?? customer.nameAr,
      phone: input.phone ?? customer.phone ?? undefined,
      excludeId: id,
    });
    if (dup.all.length) throw conflict(DUPLICATE_MESSAGE, { code: 'duplicate_customer' });
  }
  const events: Record<string, unknown>[] = [];
  const set: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined) continue;
    if (k === 'tags') set.tags = await canonicalTags(TAG_SCOPE, v as string[]);
    else if (k === 'nameAr') {
      set.nameAr = v;
      set.normalizedName = normalizeArabic(v as string);
    } else if (k === 'phone') {
      set.phone = v;
      set.phoneDigits = digits(v as string);
    } else if (k === 'crNumber' || k === 'unifiedNumber' || k === 'vatNumber' || k === 'nationalAddress') {
      // Legal identity lives on the party (FIN §8); only Finance edits tax numbers once the party exists.
      if (customer.partyId && k === 'vatNumber' && !req.auth.roleCodes.some((r) => r.startsWith('finance_')))
        throw forbidden('الرقم الضريبي يعدّله القسم المالي');
      set[`party.${k}`] = v;
    } else set[k] = v;
  }
  if (input.status && input.status !== customer.status)
    events.push({
      customerId: customer._id,
      type: 'status_changed',
      from: customer.status,
      to: input.status,
      byUserId: actor.userId,
      byEmail: actor.email,
    });
  if (
    input.classification !== undefined &&
    (input.classification ?? null) !== (customer.classification ?? null)
  )
    events.push({
      customerId: customer._id,
      type: 'classification_changed',
      from: customer.classification,
      to: input.classification ?? undefined,
      byUserId: actor.userId,
      byEmail: actor.email,
    });
  const partyUpdate: Record<string, unknown> = {};
  for (const k of Object.keys(set)) if (k.startsWith('party.')) partyUpdate[k.slice(6)] = set[k];
  for (const k of Object.keys(partyUpdate)) delete set[`party.${k}`];
  await withTransaction(async (session) => {
    if (Object.keys(partyUpdate).length) {
      if (customer.partyId)
        await Party.updateOne({ _id: customer.partyId }, { $set: partyUpdate }, { session });
      else {
        const party = await ensureCustomerParty(
          { legalNameAr: customer.nameAr, ...(partyUpdate as Record<string, string>) },
          session,
        );
        set.partyId = party._id;
      }
    }
    if (input.classification === null) {
      set.classification = undefined;
      await Customer.updateOne(
        { _id: customer._id },
        { $set: set, $unset: { classification: 1 } },
        { session },
      );
    } else await Customer.updateOne({ _id: customer._id }, { $set: set }, { session });
    if (events.length) await CustomerEvent.create(events, { session, ordered: true });
    await recordAudit(
      actor,
      { action: 'update', resource: 'crm.customers', resourceId: id, before, after: set },
      session,
    );
  });
  return getCustomer(req, id);
}

// ------------------------------------------------------------------------------------------------
// Contacts (≤ 3) [SAL §4.1 ثانياً]
// ------------------------------------------------------------------------------------------------
export async function addContact(req: AuthedRequest, customerId: string, input: ContactInput) {
  const { customer } = await loadCustomerFor(req, customerId, 'edit');
  const actor = actorFrom(req);
  return withTransaction(async (session) => {
    const count = await Contact.countDocuments({ customerId: customer._id, deletedAt: null }).session(
      session ?? null,
    );
    if (count >= MAX_CONTACTS_PER_CUSTOMER)
      throw conflict(`الحد الأقصى ${MAX_CONTACTS_PER_CUSTOMER} أشخاص مسؤولين لكل جهة`, {
        code: 'max_contacts',
      });
    const [c] = await Contact.create([{ ...input, customerId: customer._id }], { session, ordered: true });
    await recordAudit(
      actor,
      { action: 'create', resource: 'crm.contacts', resourceId: String(c._id), after: c },
      session,
    );
    return c;
  });
}
export async function updateContact(
  req: AuthedRequest,
  customerId: string,
  contactId: string,
  input: Partial<ContactInput>,
) {
  await loadCustomerFor(req, customerId, 'edit');
  const before = await Contact.findOne({ _id: contactId, customerId, deletedAt: null }).lean();
  if (!before) throw notFound();
  const after = await Contact.findByIdAndUpdate(contactId, { $set: input }, { new: true }).lean();
  await recordAudit(actorFrom(req), {
    action: 'update',
    resource: 'crm.contacts',
    resourceId: contactId,
    before,
    after,
  });
  return after;
}
export async function removeContact(req: AuthedRequest, customerId: string, contactId: string) {
  await loadCustomerFor(req, customerId, 'edit');
  const before = await Contact.findOne({ _id: contactId, customerId, deletedAt: null }).lean();
  if (!before) throw notFound();
  await Contact.updateOne({ _id: contactId }, { $set: { deletedAt: new Date() } });
  await recordAudit(actorFrom(req), {
    action: 'delete',
    resource: 'crm.contacts',
    resourceId: contactId,
    before,
  });
}

// ------------------------------------------------------------------------------------------------
// Communication log — append-only [SAL §4.1 ثالثاً, §10.2]
// ------------------------------------------------------------------------------------------------
export async function addLog(req: AuthedRequest, customerId: string, input: CreateCommunicationLogInput) {
  // Anyone who may VIEW the file may log a contact (a manager following up on a rep's customer); the entry carries its author.
  const { customer } = await loadCustomerFor(req, customerId, 'view');
  const actor = actorFrom(req);
  const now = new Date();
  const log = await withTransaction(async (session) => {
    const [doc] = await CommunicationLog.create(
      [
        {
          customerId: customer._id,
          opportunityId: input.opportunityId,
          authorUserId: req.auth.user._id,
          authorName: req.auth.user.displayNameAr,
          at: now,
          method: input.method,
          details: input.details,
          outcome: input.outcome,
          customerNeed: input.customerNeed,
          nextStep: input.nextStep,
          nextFollowUpAt: input.nextFollowUpAt ? new Date(input.nextFollowUpAt) : undefined,
          attachmentIds: input.attachmentIds,
        },
      ],
      { session, ordered: true },
    );
    if (input.attachmentIds.length)
      await claimAttachments(
        input.attachmentIds,
        'customer',
        String(customer._id),
        req.auth.user._id,
        session,
      );
    const set: Record<string, unknown> = { lastContactAt: now };
    if (input.nextFollowUpAt) set.nextFollowUpAt = new Date(input.nextFollowUpAt);
    await Customer.updateOne({ _id: customer._id }, { $set: set }, { session });
    await recordAudit(
      actor,
      {
        action: 'create',
        resource: 'crm.logs',
        resourceId: String(doc._id),
        after: { customerId: String(customer._id), method: input.method },
      },
      session,
    );
    return doc;
  });
  return log;
}
export async function listLogs(req: AuthedRequest, customerId: string) {
  const { customer } = await loadCustomerFor(req, customerId);
  // Chronological from the first contact [SAL §4.1 ثالثاً «من أول تواصل حتى آخر تحديث»].
  return CommunicationLog.find({ customerId: customer._id }).sort({ at: 1 }).lean();
}

// ------------------------------------------------------------------------------------------------
// Ownership transfer [SAL §8.1, §14 «تغيير الموظف المسؤول», §19]
// ------------------------------------------------------------------------------------------------
export async function transferCustomers(req: AuthedRequest, input: TransferCustomersInput) {
  const authz = req.authz!;
  if (!isManagerScope(authz.scope)) throw forbidden('نقل العملاء من صلاحيات مدير القسم');
  const to = await assertSalesTarget(authz, input.toUserId);
  const filter = {
    _id: { $in: input.customerIds },
    deletedAt: null,
    ...customerScopeFilter(req.auth.user, authz),
  };
  const customers = await Customer.find(filter).select('_id number nameAr ownerUserId').lean();
  if (customers.length !== input.customerIds.length)
    throw notFound('بعض العملاء غير موجودين أو خارج نطاق صلاحيتك');
  const actor = actorFrom(req);
  const batchId = randomUUID();
  const moved = customers.filter((c) => String(c.ownerUserId) !== String(to._id));
  if (!moved.length) return { moved: 0, batchId };
  await withTransaction(async (session) => {
    await Customer.updateMany(
      { _id: { $in: moved.map((c) => c._id) } },
      { $set: { ownerUserId: to._id } },
      { session },
    );
    await CustomerEvent.create(
      moved.map((c) => ({
        customerId: c._id,
        type: 'owner_changed',
        fromUserId: c.ownerUserId,
        toUserId: to._id,
        byUserId: actor.userId,
        byEmail: actor.email,
        reason: input.reason,
        batchId,
      })),
      { session, ordered: true },
    );
    if (input.includeOpportunities)
      for (const hook of ownerChangeHooks)
        await hook({
          customerIds: moved.map((c) => String(c._id)),
          fromByCustomer: new Map(moved.map((c) => [String(c._id), String(c.ownerUserId)])),
          toUserId: String(to._id),
          actor,
          reason: input.reason,
          batchId,
          session,
        });
    await recordAudit(
      actor,
      {
        action: 'update',
        resource: 'crm.customers',
        resourceId: batchId,
        meta: {
          transfer: true,
          count: moved.length,
          toUserId: String(to._id),
          reason: input.reason,
          customerIds: moved.map((c) => String(c._id)),
        },
      },
      session,
    );
    for (const c of moved)
      await publish(
        {
          type: 'crm.customer.owner_changed',
          aggregateType: 'customer',
          aggregateId: String(c._id),
          payload: { fromUserId: String(c.ownerUserId), toUserId: String(to._id), batchId },
          actorUserId: actor.userId,
        },
        session,
      );
  });
  // Both reps are told [SAL §14 item 16]; one notification per batch per person, listing the customers.
  const summary = moved.length === 1 ? `${moved[0].number} — ${moved[0].nameAr}` : `${moved.length} عملاء`;
  const previousOwners = [...new Set(moved.map((c) => String(c.ownerUserId)))];
  await notify({
    userIds: [String(to._id)],
    type: 'crm.customer.assigned',
    bodyAr: `${summary} (${input.reason})`,
    link: moved.length === 1 ? `/sales/customers/${moved[0]._id}` : '/sales/customers',
    data: { batchId },
  });
  await notify({
    userIds: previousOwners.filter((u) => u !== String(to._id)),
    type: 'crm.owner_changed',
    bodyAr: `${summary} → ${to.displayNameAr} (${input.reason})`,
    link: '/sales/customers',
    data: { batchId },
  });
  return { moved: moved.length, batchId };
}

// ------------------------------------------------------------------------------------------------
// Leads [SAL §3, §8.1; CS §6.8]
// ------------------------------------------------------------------------------------------------
export async function canReferLeads(req: AuthedRequest): Promise<boolean> {
  if (await permissionOn(req, 'crm.leads', 'create')) return true;
  const u = req.auth.user;
  if (!u.departmentId) return false;
  const code = (await Department.findById(u.departmentId).select('code').lean())?.code;
  return code === 'cs';
}

export async function createLead(req: AuthedRequest, input: CreateLeadInput) {
  if (!(await canReferLeads(req))) throw forbidden('إحالة العملاء المحتملين من صلاحيات خدمة العملاء');
  const targetDepartmentId = await departmentIdByCode(input.targetDepartment);
  if (!targetDepartmentId) throw badRequest('القسم المستهدف غير معرّف');
  if (input.customerId && !(await Customer.exists({ _id: input.customerId, deletedAt: null })))
    throw badRequest('العميل غير موجود');
  const actor = actorFrom(req);
  const lead = await withTransaction(async (session) => {
    const [doc] = await Lead.create(
      [
        {
          number: await nextNumber('lead', session),
          ...input,
          phoneDigits: digits(input.phone),
          targetDepartmentId,
          referredByUserId: req.auth.user._id,
          referredByDepartmentId: req.auth.user.departmentId,
          referredAt: new Date(),
          state: 'new',
        },
      ],
      { session, ordered: true },
    );
    if (input.attachmentIds.length)
      await claimAttachments(input.attachmentIds, 'lead', String(doc._id), req.auth.user._id, session);
    await LeadEvent.create(
      [{ leadId: doc._id, type: 'referred', to: 'new', byUserId: actor.userId, byEmail: actor.email }],
      { session, ordered: true },
    );
    await recordAudit(
      actor,
      {
        action: 'create',
        resource: 'crm.leads',
        resourceId: String(doc._id),
        after: { number: doc.number, customerName: doc.customerName },
      },
      session,
    );
    await publish(
      {
        type: 'crm.lead.referred',
        aggregateType: 'lead',
        aggregateId: String(doc._id),
        payload: { number: doc.number, targetDepartment: input.targetDepartment },
        actorUserId: actor.userId,
      },
      session,
    );
    return doc;
  });
  // Notification 1 [SAL §14]: the receiving department's managers.
  const managers =
    input.targetDepartment === 'sales'
      ? await salesManagerUserIds(targetDepartmentId)
      : await departmentManagerUserIds(targetDepartmentId);
  await notify({
    userIds: managers,
    type: 'crm.lead.referred',
    bodyAr: `${lead.number} — ${lead.customerName}: ${lead.interest}`,
    link: `/sales/leads?lead=${lead._id}`,
    data: { leadId: String(lead._id) },
  });
  return lead;
}

export interface ListLeadsQuery {
  page: number;
  limit: number;
  state?: string;
  open?: boolean;
  overdue?: boolean;
  assigneeUserId?: string;
  targetDepartment?: string;
  view?: 'mine' | 'department' | 'referred';
}
async function leadScopeFilter(req: AuthedRequest, view?: string): Promise<FilterQuery<unknown> | null> {
  if (view === 'referred') return { referredByUserId: req.auth.user._id };
  const eff = await permissionOn(req, 'crm.leads', 'view');
  if (!eff) return null;
  if (eff.scope === 'all') return view === 'mine' ? { assigneeUserId: req.auth.user._id } : {};
  if (eff.scope === 'department')
    return view === 'mine'
      ? { assigneeUserId: req.auth.user._id }
      : { $or: [{ targetDepartmentId: { $in: eff.departmentIds } }, { assigneeUserId: req.auth.user._id }] };
  return { assigneeUserId: req.auth.user._id };
}
export async function listLeads(req: AuthedRequest, q: ListLeadsQuery) {
  const scope = await leadScopeFilter(req, q.view);
  if (!scope) {
    // Without a Sales grant only the caller's own referrals are visible (Customer Service users).
    if (!(await canReferLeads(req))) throw forbidden();
    q.view = 'referred';
  }
  const filter: FilterQuery<unknown> = {
    deletedAt: null,
    ...(scope ?? { referredByUserId: req.auth.user._id }),
  };
  if (q.state) filter.state = q.state;
  if (q.open) filter.state = { $in: OPEN_LEAD_STATES };
  if (q.assigneeUserId) filter.assigneeUserId = q.assigneeUserId;
  if (q.targetDepartment) filter.targetDepartment = q.targetDepartment;
  if (q.overdue) {
    const hours = await getSetting('crm.leadRegistrationHours');
    filter.registeredAt = null;
    filter.state = { $in: OPEN_LEAD_STATES };
    filter.referredAt = { $lt: new Date(Date.now() - hours * 3_600_000) };
  }
  const [rows, total, hours] = await Promise.all([
    Lead.find(filter)
      .sort({ referredAt: -1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .lean(),
    Lead.countDocuments(filter),
    getSetting('crm.leadRegistrationHours'),
  ]);
  const names = await userNames(rows.flatMap((r) => [r.assigneeUserId, r.referredByUserId]));
  const deadline = (r: LeadDoc) => new Date(r.referredAt.getTime() + hours * 3_600_000);
  return {
    items: rows.map((r) => ({
      ...r,
      assigneeName: r.assigneeUserId ? names.get(String(r.assigneeUserId)) : undefined,
      referredByName: names.get(String(r.referredByUserId)),
      registrationDeadline: deadline(r as LeadDoc),
      overdue:
        !r.registeredAt &&
        (OPEN_LEAD_STATES as readonly string[]).includes(r.state) &&
        deadline(r as LeadDoc) < new Date(),
    })),
    total,
    page: q.page,
    limit: q.limit,
    registrationHours: hours,
  };
}

async function loadLeadFor(req: AuthedRequest, id: string, action: 'view' | 'edit' | 'approve') {
  const lead = await Lead.findOne({ _id: id, deletedAt: null });
  if (!lead) throw notFound();
  if (action === 'view' && String(lead.referredByUserId) === String(req.auth.user._id))
    return { lead, manager: false };
  const eff = await permissionOn(req, 'crm.leads', action);
  if (!eff) throw forbidden();
  const manager =
    isManagerScope(eff.scope) &&
    (eff.scope === 'all' || eff.departmentIds.includes(String(lead.targetDepartmentId)));
  if (!manager && String(lead.assigneeUserId ?? '') !== String(req.auth.user._id)) throw forbidden();
  return { lead, manager };
}
export async function canAccessLead(req: AuthedRequest, id: string): Promise<boolean> {
  try {
    await loadLeadFor(req, id, 'view');
    return true;
  } catch {
    return false;
  }
}
export async function getLead(req: AuthedRequest, id: string) {
  const { lead, manager } = await loadLeadFor(req, id, 'view');
  const [events, names] = await Promise.all([
    LeadEvent.find({ leadId: lead._id }).sort({ at: 1 }).lean(),
    userNames([lead.assigneeUserId, lead.referredByUserId]),
  ]);
  return {
    ...lead.toObject(),
    assigneeName: lead.assigneeUserId ? names.get(String(lead.assigneeUserId)) : undefined,
    referredByName: names.get(String(lead.referredByUserId)),
    events,
    canManage: manager,
  };
}

/** The Sales manager distributes leads to reps [SAL §8.1 «توجيه العملاء وتوزيعهم على موظفي القسم»]. */
export async function assignLead(req: AuthedRequest, id: string, assigneeUserId: string) {
  const { lead, manager } = await loadLeadFor(req, id, 'approve');
  if (!manager) throw forbidden('توزيع العملاء المحتملين من صلاحيات مدير القسم');
  const eff = (await permissionOn(req, 'crm.leads', 'approve'))!;
  const to = await assertSalesTarget({ resource: 'crm.leads', action: 'approve', ...eff }, assigneeUserId);
  const actor = actorFrom(req);
  const from = lead.assigneeUserId ? String(lead.assigneeUserId) : undefined;
  await withTransaction(async (session) => {
    const set: Record<string, unknown> = { assigneeUserId: to._id, assignedAt: new Date() };
    if (lead.state === 'new') set.state = 'referred';
    await Lead.updateOne({ _id: lead._id }, { $set: set }, { session });
    await LeadEvent.create(
      [
        {
          leadId: lead._id,
          type: 'assigned',
          from,
          to: String(to._id),
          byUserId: actor.userId,
          byEmail: actor.email,
        },
      ],
      { session, ordered: true },
    );
    await recordAudit(
      actor,
      {
        action: 'update',
        resource: 'crm.leads',
        resourceId: id,
        before: { assigneeUserId: from },
        after: { assigneeUserId: String(to._id) },
      },
      session,
    );
  });
  // Notification 2 [SAL §14]: the rep is told a customer was assigned to them.
  await notify({
    userIds: [String(to._id)],
    type: 'crm.customer.assigned',
    bodyAr: `${lead.number} — ${lead.customerName}`,
    link: `/sales/leads?lead=${lead._id}`,
    data: { leadId: id },
  });
  return getLead(req, id);
}

export async function setLeadState(
  req: AuthedRequest,
  id: string,
  input: { state: LeadDoc['state']; outcome?: string },
) {
  const { lead } = await loadLeadFor(req, id, 'edit');
  if (input.state === 'converted') throw badRequest('التحويل إلى عميل يكون عبر إجراء التحويل');
  if ((input.state === 'not_interested' || input.state === 'closed') && !input.outcome)
    throw badRequest('النتيجة مطلوبة عند الإغلاق');
  const actor = actorFrom(req);
  await withTransaction(async (session) => {
    const set: Record<string, unknown> = { state: input.state };
    if (input.outcome) set.outcome = input.outcome;
    if (input.state === 'opportunity' || input.state === 'following_up')
      set.registeredAt = lead.registeredAt ?? new Date();
    await Lead.updateOne({ _id: lead._id }, { $set: set }, { session });
    await LeadEvent.create(
      [
        {
          leadId: lead._id,
          type: 'state_changed',
          from: lead.state,
          to: input.state,
          byUserId: actor.userId,
          byEmail: actor.email,
          note: input.outcome,
        },
      ],
      { session, ordered: true },
    );
    await recordAudit(
      actor,
      {
        action: 'transition',
        resource: 'crm.leads',
        resourceId: id,
        before: { state: lead.state },
        after: { state: input.state },
      },
      session,
    );
  });
  return getLead(req, id);
}

/** Convert a lead into a customer (new or existing) and optionally an opportunity, keeping the link [SAL §3]. */
export async function convertLead(
  req: AuthedRequest,
  id: string,
  input: {
    customerId?: string;
    createOpportunity: boolean;
    opportunityTitle?: string;
    expectedValueHalalas?: number;
  },
) {
  const { lead } = await loadLeadFor(req, id, 'edit');
  if (lead.state === 'converted') throw conflict('تم تحويل هذا العميل المحتمل مسبقًا');
  let customerId: string;
  if (input.customerId) {
    if (!(await canAccessCustomer(req, input.customerId))) throw notFound('العميل غير موجود');
    customerId = input.customerId;
    const actor = actorFrom(req);
    await withTransaction(async (session) => {
      await Lead.updateOne(
        { _id: lead._id },
        { $set: { state: 'converted', customerId, registeredAt: lead.registeredAt ?? new Date() } },
        { session },
      );
      await Customer.updateOne(
        { _id: customerId, leadId: null },
        { $set: { leadId: lead._id } },
        { session },
      );
      await LeadEvent.create(
        [
          {
            leadId: lead._id,
            type: 'converted',
            from: lead.state,
            to: 'converted',
            byUserId: actor.userId,
            byEmail: actor.email,
          },
        ],
        { session, ordered: true },
      );
      await CustomerEvent.create(
        [{ customerId, type: 'lead_linked', to: lead.number, byUserId: actor.userId, byEmail: actor.email }],
        { session, ordered: true },
      );
      for (const hook of leadConvertedHooks) await hook({ lead, customerId, input, req, session });
      await recordAudit(
        actor,
        {
          action: 'transition',
          resource: 'crm.leads',
          resourceId: id,
          before: { state: lead.state },
          after: { state: 'converted', customerId },
        },
        session,
      );
    });
  } else {
    // A new file from the lead data; the lead's assignee (or the manager acting) becomes الموظف المسؤول.
    const created = await createCustomer(
      {
        ...req,
        authz: req.authz ?? {
          resource: 'crm.customers',
          action: 'create',
          ...(await permissionOn(req, 'crm.customers', 'create'))!,
        },
      } as AuthedRequest,
      {
        kind: 'organization',
        nameAr: lead.customerName,
        source: 'customer_service',
        status: 'potential',
        phone: lead.phone ?? undefined,
        email: lead.email ?? undefined,
        notes: lead.notes ?? undefined,
        tags: [],
        contacts: lead.contactName
          ? [{ nameAr: lead.contactName, phone: lead.phone ?? undefined, email: lead.email ?? undefined }]
          : [],
        leadId: String(lead._id),
        ownerUserId: lead.assigneeUserId ? String(lead.assigneeUserId) : undefined,
        opportunity: input.createOpportunity
          ? {
              title: input.opportunityTitle ?? lead.interest,
              expectedValueHalalas: input.expectedValueHalalas,
            }
          : undefined,
      },
    );
    customerId = String(created._id);
  }
  return { ...(await getLead(req, id)), customerId };
}
