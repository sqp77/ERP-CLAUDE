import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../http/async';
import { validate } from '../http/validate';
import type { AuthedRequest } from '../http/context';
import { requireAuth } from '../auth/middleware';
import { Notification } from './model';
import { unreadCount } from './service';

export const notificationsRouter = Router();

const listQuery = z.object({
  unread: z.coerce.boolean().optional(),
  /** Comma-separated notification types (EP §15 groups are built on the client). */
  types: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

notificationsRouter.get(
  '/',
  requireAuth(),
  validate(listQuery, 'query'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const q = req.query as unknown as z.infer<typeof listQuery>;
    const filter: Record<string, unknown> = { userId: req.auth.user._id };
    if (q.unread) filter.readAt = null;
    if (q.types) filter.type = { $in: q.types.split(',').filter(Boolean) };
    const [items, total, unread] = await Promise.all([
      Notification.find(filter)
        .sort({ createdAt: -1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .lean(),
      Notification.countDocuments(filter),
      unreadCount(String(req.auth.user._id)),
    ]);
    res.json({ items, total, unread, page: q.page, limit: q.limit });
  }),
);

notificationsRouter.post(
  '/read-all',
  requireAuth(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const r = await Notification.updateMany(
      { userId: req.auth.user._id, readAt: null },
      { $set: { readAt: new Date() } },
    );
    res.json({ updated: r.modifiedCount });
  }),
);

notificationsRouter.post(
  '/:id/read',
  requireAuth(),
  asyncHandler(async (req: AuthedRequest, res) => {
    await Notification.updateOne(
      { _id: req.params.id, userId: req.auth.user._id, readAt: null },
      { $set: { readAt: new Date() } },
    );
    res.json({ ok: true });
  }),
);
