import { Router } from 'express';
import { holidaySchema } from '@eayni/shared';
import { asyncHandler } from '../http/async';
import { validate } from '../http/validate';
import { actorFrom, type AuthedRequest } from '../http/context';
import { notFound } from '../http/errors';
import { requireAuth } from '../auth/middleware';
import { authorize } from '../rbac/authorize';
import { recordAudit } from '../audit/service';
import { Holiday } from './model';

export const holidaysRouter = Router();

holidaysRouter.get(
  '/',
  requireAuth(),
  authorize('holidays', 'view'),
  asyncHandler(async (req, res) => {
    const year = typeof req.query.year === 'string' ? req.query.year : undefined;
    const filter = year ? { date: new RegExp(`^${year}-`) } : {};
    res.json({ items: await Holiday.find(filter).sort({ date: 1 }).lean() });
  }),
);

holidaysRouter.post(
  '/',
  requireAuth(),
  authorize('holidays', 'create'),
  validate(holidaySchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    const doc = await Holiday.create(req.body);
    await recordAudit(actorFrom(req), {
      action: 'create',
      resource: 'holidays',
      resourceId: String(doc._id),
      after: doc,
    });
    res.status(201).json(doc);
  }),
);

holidaysRouter.delete(
  '/:id',
  requireAuth(),
  authorize('holidays', 'delete'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const doc = await Holiday.findById(req.params.id).lean();
    if (!doc) throw notFound();
    await Holiday.deleteOne({ _id: doc._id });
    await recordAudit(actorFrom(req), {
      action: 'delete',
      resource: 'holidays',
      resourceId: req.params.id,
      before: doc,
    });
    res.status(204).end();
  }),
);
