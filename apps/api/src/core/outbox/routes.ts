import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../http/async';
import { validate } from '../http/validate';
import { actorFrom, type AuthedRequest } from '../http/context';
import { requireAuth } from '../auth/middleware';
import { authorize } from '../rbac/authorize';
import { Outbox } from './model';
import { requeueEvent } from './service';

/** Admin view of the outbox (review G8): failed / expired / unhandled events and a manual requeue. */
export const outboxRouter = Router();

const listSchema = z.object({
  status: z.enum(['pending', 'processing', 'delivered', 'failed', 'unhandled', 'expired']).optional(),
  type: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

outboxRouter.get(
  '/',
  requireAuth(),
  authorize('outbox', 'view'),
  validate(listSchema, 'query'),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof listSchema>;
    const filter: Record<string, unknown> = {};
    if (q.status) filter.status = q.status;
    else filter.status = { $in: ['failed', 'expired', 'unhandled'] };
    if (q.type) filter.type = q.type;
    const [items, total, counts] = await Promise.all([
      Outbox.find(filter)
        .sort({ createdAt: -1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .select(
          'type aggregateType aggregateId status attempts availableAt lastError deliveredAt createdAt handledBy',
        )
        .lean(),
      Outbox.countDocuments(filter),
      Outbox.aggregate<{ _id: string; n: number }>([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    ]);
    res.json({
      items,
      total,
      page: q.page,
      limit: q.limit,
      counts: Object.fromEntries(counts.map((c) => [c._id, c.n])),
    });
  }),
);

outboxRouter.post(
  '/:id/requeue',
  requireAuth(),
  authorize('outbox', 'edit'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const ev = await requeueEvent(req.params.id, actorFrom(req));
    res.json({ _id: ev._id, status: ev.status, attempts: ev.attempts });
  }),
);
