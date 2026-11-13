import { createHash } from 'node:crypto';
import { Router } from 'express';
import type { z } from 'zod';
import {
  createEventSchema,
  listEventsQuerySchema,
  peopleQuerySchema,
  updateEventSchema,
} from '@eayni/shared';
import { asyncHandler } from '../http/async';
import { validate } from '../http/validate';
import { actorFrom, type AuthedRequest } from '../http/context';
import { badRequest, forbidden, notFound } from '../http/errors';
import { requireAuth } from '../auth/middleware';
import { authorize } from '../rbac/authorize';
import { recordAudit } from '../audit/service';
import { nextNumber } from '../numbering/service';
import { notify } from '../notifications/service';
import { formatHijri } from '../dates/businessDays';
import { resolveRecord, searchPeople } from '../records/resolvers';
import { publish } from '../outbox/service';
import { departmentManagerUserIds } from '../tasks/jobs';
import { Department } from '../org/model';
import { withTransaction } from '../../db';
import { collectCalendarItems } from './sources';
import { CalendarEvent } from './model';

export const calendarRouter = Router();

async function visibilityFilter(req: AuthedRequest) {
  const userId = req.auth.user._id;
  if (req.authz!.scope === 'all') return {};
  if (req.authz!.scope === 'department') {
    return {
      $or: [
        { ownerId: userId },
        { participantIds: userId },
        { departmentIds: { $in: req.authz!.departmentIds } },
      ],
    };
  }
  return { $or: [{ ownerId: userId }, { participantIds: userId }] };
}

const eventLink = (id: unknown) => `/calendar?event=${id}`;

/** Department calendars: an event may be tagged only with the creator's own department or departments in their authz scope (review E6). */
function assertDepartmentsAllowed(req: AuthedRequest, departmentIds: string[] | undefined) {
  if (!departmentIds?.length) return;
  if (req.authz!.scope === 'all') return;
  const allowed = new Set([
    ...req.authz!.departmentIds,
    ...(req.auth.user.departmentId ? [String(req.auth.user.departmentId)] : []),
  ]);
  if (departmentIds.some((d) => !allowed.has(d))) throw forbidden('لا يمكنك إضافة موعد إلى تقويم قسم آخر');
}

async function ownerInDepartments(ownerId: unknown, departmentIds: string[]): Promise<boolean> {
  const { User } = await import('../auth/model');
  const owner = await User.findById(ownerId).select('departmentId').lean();
  return !!owner?.departmentId && departmentIds.includes(String(owner.departmentId));
}
const participantsOf = (ev: { ownerId: unknown; participantIds: unknown[] }, except?: string) =>
  [...new Set([String(ev.ownerId), ...ev.participantIds.map(String)])].filter((id) => id !== except);

/** An event that needs Marketing names the event, its date, its place and the organizer [SAL §9]. */
function assertMarketingFields(ev: {
  needsMarketing?: boolean | null;
  location?: string | null;
  locationUrl?: string | null;
  organizer?: string | null;
}) {
  if (!ev.needsMarketing) return;
  const issues = [];
  if (!ev.location?.trim() && !ev.locationUrl?.trim())
    issues.push({ path: 'location', message: 'موقع الفعالية مطلوب لإشعار التسويق' });
  if (!ev.organizer?.trim())
    issues.push({ path: 'organizer', message: 'الجهة المنظمة مطلوبة لإشعار التسويق' });
  if (issues.length) throw badRequest('أكمل بيانات الفعالية قبل إشعار قسم التسويق', issues);
}

/**
 * «إرسال إشعار إلى قسم التسويق» [SAL §9]: the managers and members of the department whose code is `marketing`,
 * once per event (conditional claim on `marketingNotifiedAt`). Returns whether anyone was told.
 */
async function noticeMarketing(
  req: AuthedRequest,
  ev: {
    _id: unknown;
    title: string;
    startAt: Date;
    location?: string | null;
    locationUrl?: string | null;
    organizer?: string | null;
  },
): Promise<'sent' | 'already_sent' | 'no_department'> {
  const dept = await Department.findOne({ code: 'marketing', deletedAt: null })
    .select('managerUserId')
    .lean();
  if (!dept) return 'no_department';
  const { User } = await import('../auth/model');
  const [managers, members] = await Promise.all([
    departmentManagerUserIds(String(dept._id)),
    User.find({ departmentId: dept._id, status: 'active', deletedAt: null }).select('_id').lean(),
  ]);
  const to = [
    ...new Set([
      ...managers,
      ...members.map((m) => String(m._id)),
      ...(dept.managerUserId ? [String(dept.managerUserId)] : []),
    ]),
  ].filter((u) => u !== String(req.auth.user._id));
  if (!to.length) return 'no_department';
  const claimed = await CalendarEvent.updateOne(
    { _id: ev._id, marketingNotifiedAt: null },
    { $set: { marketingNotifiedAt: new Date() } },
  );
  if (!claimed.modifiedCount) return 'already_sent';
  const day = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', {
    timeZone: 'Asia/Riyadh',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(ev.startAt);
  await notify({
    userIds: to,
    type: 'sales.marketing_notice',
    bodyAr: `${ev.title} — ${day} — ${ev.location ?? ev.locationUrl ?? ''} — الجهة المنظمة: ${ev.organizer ?? ''} — من ${req.auth.user.displayNameAr}`,
    link: eventLink(ev._id),
  });
  await recordAudit(actorFrom(req), {
    action: 'update',
    resource: 'calendar',
    resourceId: String(ev._id),
    after: { marketingNotified: to.length },
  });
  return 'sent';
}

/**
 * A meeting or visit linked to a customer whose outcome is recorded feeds the customer's communication log through
 * the outbox [SAL §9 «تسجيل نتائج الاجتماع… ربط الاجتماع بملف العميل», §4.1 ثالثاً]; CRM writes the entry.
 */
async function publishOutcome(
  req: AuthedRequest,
  ev: {
    _id: unknown;
    title: string;
    type?: string | null;
    meetingType?: string | null;
    status?: string | null;
    outcome?: string | null;
    nextFollowUpAt?: Date | null;
    link?: { type?: string | null; id?: string | null } | null;
  },
  session: Parameters<Parameters<typeof withTransaction>[0]>[0],
) {
  if (ev.link?.type !== 'customer' || !ev.link.id || !ev.outcome?.trim()) return;
  const digest = createHash('sha256')
    .update(`${ev.outcome}|${ev.nextFollowUpAt?.toISOString() ?? ''}`)
    .digest('hex')
    .slice(0, 16);
  await publish(
    {
      type: 'calendar.meeting.outcome_recorded',
      aggregateType: 'calendar_event',
      aggregateId: String(ev._id),
      idempotencyKey: `calendar.outcome:${String(ev._id)}:${digest}`,
      actorUserId: String(req.auth.user._id),
      payload: {
        eventId: String(ev._id),
        customerId: ev.link.id,
        title: ev.title,
        eventType: ev.type,
        meetingType: ev.meetingType,
        status: ev.status,
        outcome: ev.outcome,
        nextFollowUpAt: ev.nextFollowUpAt?.toISOString() ?? null,
        authorUserId: String(req.auth.user._id),
        authorName: req.auth.user.displayNameAr,
        at: new Date().toISOString(),
      },
    },
    session ?? undefined,
  );
}

/** Events plus read-only items from other modules (tasks due, secondments…) [EP §13.3–13.7]. */
calendarRouter.get(
  '/events',
  requireAuth(),
  authorize('calendar', 'view'),
  validate(listEventsQuerySchema, 'query'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const q = req.query as unknown as z.infer<typeof listEventsQuerySchema>;
    const filter: Record<string, unknown> = {
      deletedAt: null,
      startAt: { $lt: q.to },
      endAt: { $gte: q.from },
      ...(await visibilityFilter(req)),
    };
    if (q.type) filter.type = q.type;
    if (q.departmentId) filter.departmentIds = q.departmentId;
    if (q.userId) filter.$and = [{ $or: [{ ownerId: q.userId }, { participantIds: q.userId }] }];
    const events = await CalendarEvent.find(filter).sort({ startAt: 1 }).lean();
    const only = q.include === undefined ? undefined : q.include.split(',').filter(Boolean);
    const extra = q.include === 'none' || q.type ? [] : await collectCalendarItems(req, q.from, q.to, only);
    const items = [
      ...events.map((e) => ({ ...e, source: 'event' as const, readOnly: false })),
      ...extra.map((e) => ({ ...e, source: 'module' as const })),
    ]
      .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
      .map((e) => ({ ...e, startHijri: formatHijri(new Date(e.startAt)) }));
    res.json({ items });
  }),
);

/** Colleagues for the participants picker (name search over the employee file). */
calendarRouter.get(
  '/people',
  requireAuth(),
  validate(peopleQuerySchema, 'query'),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json({ items: await searchPeople((req.query as { q: string }).q, 20) });
  }),
);

calendarRouter.post(
  '/events',
  requireAuth(),
  authorize('calendar', 'create'),
  validate(createEventSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = req.body as z.infer<typeof createEventSchema>;
    let link = body.link;
    if (link) {
      const found = await resolveRecord(link.type, link.id, req); // same 400 when not found or not allowed [EP §13.12]
      if (!found) throw badRequest('السجل المرتبط غير موجود');
      link = { type: link.type, ...found };
    }
    assertDepartmentsAllowed(req, body.departmentIds);
    assertMarketingFields(body);
    const ev = await CalendarEvent.create({
      ...body,
      link,
      number: await nextNumber('event'),
      ownerId: req.auth.user._id,
    });
    await recordAudit(actorFrom(req), {
      action: 'create',
      resource: 'calendar',
      resourceId: String(ev._id),
      after: ev,
    });
    const others = participantsOf(ev, String(req.auth.user._id));
    if (others.length)
      await notify({
        userIds: others,
        type: ev.type === 'training' ? 'training.added' : 'meeting.created', // EP §15.4, §15.17
        bodyAr: ev.title,
        link: eventLink(ev._id),
      });
    const marketingNotice = ev.needsMarketing ? await noticeMarketing(req, ev) : undefined;
    res.status(201).json({ ...ev.toObject(), marketingNotice });
  }),
);

/** Update / reschedule / status [EP §13.11]: a time change without an explicit status marks it rescheduled and tells the participants. */
/** One event by id (go-live review H4): deep links from notifications open it on its own date. */
calendarRouter.get(
  '/events/:id',
  requireAuth(),
  authorize('calendar', 'view'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const ev = await CalendarEvent.findOne({
      _id: req.params.id,
      deletedAt: null,
      ...(await visibilityFilter(req)),
    }).lean();
    if (!ev) throw notFound();
    res.json({ ...ev, source: 'event', readOnly: false, startHijri: formatHijri(new Date(ev.startAt)) });
  }),
);

calendarRouter.patch(
  '/events/:id',
  requireAuth(),
  authorize('calendar', 'edit'),
  validate(updateEventSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = req.body as z.infer<typeof updateEventSchema>;
    const ev = await CalendarEvent.findOne({
      _id: req.params.id,
      deletedAt: null,
      ...(await visibilityFilter(req)),
    });
    if (!ev) throw notFound();
    // Go-live review E6: the owner (or a manager whose scope covers the owner's department) edits the event;
    // participants may only set status and outcome (DECISIONS §17).
    const isOwner = String(ev.ownerId) === String(req.auth.user._id);
    const managerOverOwner =
      req.authz!.scope === 'all' ||
      (req.authz!.scope === 'department' && (await ownerInDepartments(ev.ownerId, req.authz!.departmentIds)));
    const contentKeys = Object.keys(body).filter((k) => !['status', 'outcome', 'nextFollowUpAt'].includes(k));
    if (body.needsMarketing === false && ev.marketingNotifiedAt)
      throw badRequest('أُرسل إشعار التسويق لهذه الفعالية؛ لا يمكن سحبه');
    if (contentKeys.length && !isOwner && !managerOverOwner)
      throw forbidden('تعديل الموعد من صلاحية منظّمه؛ يمكنك تحديث الحالة والنتيجة فقط');
    if (body.departmentIds) assertDepartmentsAllowed(req, body.departmentIds);
    const before = ev.toObject();
    const timeChanged =
      (body.startAt && body.startAt.getTime() !== ev.startAt.getTime()) ||
      (body.endAt && body.endAt.getTime() !== ev.endAt.getTime());
    const outcomeChanged =
      (body.outcome !== undefined && (body.outcome ?? '') !== (ev.outcome ?? '')) ||
      (body.nextFollowUpAt !== undefined &&
        (body.nextFollowUpAt?.getTime() ?? null) !== (ev.nextFollowUpAt?.getTime() ?? null));
    Object.assign(ev, body);
    if (ev.endAt < ev.startAt) ev.endAt = ev.startAt;
    if (timeChanged) {
      if (!body.status) ev.status = 'rescheduled';
      ev.remindersSent = []; // reminders fire again for the new time
    }
    assertMarketingFields(ev);
    await withTransaction(async (session) => {
      await ev.save({ session });
      if (outcomeChanged) await publishOutcome(req, ev, session);
    });
    await recordAudit(actorFrom(req), {
      action: 'update',
      resource: 'calendar',
      resourceId: String(ev._id),
      before,
      after: ev,
    });
    const others = participantsOf(ev, String(req.auth.user._id));
    if (others.length && (timeChanged || body.status === 'cancelled'))
      await notify({
        userIds: others,
        type: 'meeting.created',
        titleAr: body.status === 'cancelled' ? 'أُلغي موعد' : 'أُعيدت جدولة موعد',
        bodyAr: ev.title,
        link: eventLink(ev._id),
      });
    const marketingNotice =
      ev.needsMarketing && !before.marketingNotifiedAt ? await noticeMarketing(req, ev) : undefined;
    res.json({ ...ev.toObject(), marketingNotice });
  }),
);
