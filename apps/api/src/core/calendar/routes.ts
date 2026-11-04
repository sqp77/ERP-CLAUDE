import { Router } from 'express';
import type { z } from 'zod';
import { createEventSchema, listEventsQuerySchema, updateEventSchema } from '@eayni/shared';
import { asyncHandler } from '../http/async';
import { validate } from '../http/validate';
import { actorFrom, type AuthedRequest } from '../http/context';
import { notFound } from '../http/errors';
import { requireAuth } from '../auth/middleware';
import { authorize } from '../rbac/authorize';
import { recordAudit } from '../audit/service';
import { nextNumber } from '../numbering/service';
import { notify } from '../notifications/service';
import { formatHijri } from '../dates/businessDays';
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
    const items = await CalendarEvent.find(filter).sort({ startAt: 1 }).lean();
    res.json({ items: items.map((e) => ({ ...e, startHijri: formatHijri(e.startAt) })) });
  }),
);

calendarRouter.post(
  '/events',
  requireAuth(),
  authorize('calendar', 'create'),
  validate(createEventSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = req.body as z.infer<typeof createEventSchema>;
    const ev = await CalendarEvent.create({
      ...body,
      number: await nextNumber('event'),
      ownerId: req.auth.user._id,
    });
    await recordAudit(actorFrom(req), {
      action: 'create',
      resource: 'calendar',
      resourceId: String(ev._id),
      after: ev,
    });
    const others = body.participantIds.filter((p) => p !== String(req.auth.user._id));
    if (others.length)
      await notify({
        userIds: others,
        type: 'meeting.created',
        bodyAr: ev.title,
        link: `/calendar?event=${ev._id}`,
      });
    res.status(201).json(ev);
  }),
);

calendarRouter.patch(
  '/events/:id',
  requireAuth(),
  authorize('calendar', 'edit'),
  validate(updateEventSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    const ev = await CalendarEvent.findOne({
      _id: req.params.id,
      deletedAt: null,
      ...(await visibilityFilter(req)),
    });
    if (!ev) throw notFound();
    const before = ev.toObject();
    Object.assign(ev, req.body);
    if (ev.endAt < ev.startAt) ev.endAt = ev.startAt;
    await ev.save();
    await recordAudit(actorFrom(req), {
      action: 'update',
      resource: 'calendar',
      resourceId: String(ev._id),
      before,
      after: ev,
    });
    res.json(ev);
  }),
);
