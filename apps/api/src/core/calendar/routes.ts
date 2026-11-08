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
    res.status(201).json(ev);
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
    if (contentKeys.length && !isOwner && !managerOverOwner)
      throw forbidden('تعديل الموعد من صلاحية منظّمه؛ يمكنك تحديث الحالة والنتيجة فقط');
    if (body.departmentIds) assertDepartmentsAllowed(req, body.departmentIds);
    const before = ev.toObject();
    const timeChanged =
      (body.startAt && body.startAt.getTime() !== ev.startAt.getTime()) ||
      (body.endAt && body.endAt.getTime() !== ev.endAt.getTime());
    Object.assign(ev, body);
    if (ev.endAt < ev.startAt) ev.endAt = ev.startAt;
    if (timeChanged) {
      if (!body.status) ev.status = 'rescheduled';
      ev.remindersSent = []; // reminders fire again for the new time
    }
    await ev.save();
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
    res.json(ev);
  }),
);
