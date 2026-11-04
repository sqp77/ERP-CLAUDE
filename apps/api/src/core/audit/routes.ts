import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../http/async';
import { validate } from '../http/validate';
import { requireAuth } from '../auth/middleware';
import { authorize } from '../rbac/authorize';
import { AuditLog } from './model';

export const auditRouter = Router();

const querySchema = z.object({
  resource: z.string().optional(),
  resourceId: z.string().optional(),
  actorUserId: z.string().optional(),
  action: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

auditRouter.get(
  '/',
  requireAuth(),
  authorize('audit', 'view'),
  validate(querySchema, 'query'),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof querySchema>;
    const filter: Record<string, unknown> = {};
    if (q.resource) filter.resource = q.resource;
    if (q.resourceId) filter.resourceId = q.resourceId;
    if (q.actorUserId) filter.actorUserId = q.actorUserId;
    if (q.action) filter.action = q.action;
    if (q.from || q.to) filter.at = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) };
    const [items, total] = await Promise.all([
      AuditLog.find(filter)
        .sort({ at: -1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .lean(),
      AuditLog.countDocuments(filter),
    ]);
    res.json({ items, total, page: q.page, limit: q.limit });
  }),
);
